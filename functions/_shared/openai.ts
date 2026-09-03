/**
 * Thin, resilient OpenAI Chat Completions client.
 *
 * Handles the three things that actually break in production:
 *   1. transient 429 / 5xx  -> exponential backoff
 *   2. model-specific parameter rejections (temperature, max tokens)
 *      -> retry once with the offending parameter removed
 *   3. runaway requests -> hard timeout via AbortController
 */
import { HttpError } from "./http.ts";

const API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const BASE_URL = (Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1")
  .replace(/\/$/, "");

export const DEFAULT_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1";
const REQUEST_TIMEOUT_MS = Number(Deno.env.get("OPENAI_TIMEOUT_MS") ?? 180_000);
const MAX_ATTEMPTS = 3;

export type Usage = { prompt_tokens?: number; completion_tokens?: number };

export type ChatResult = {
  content: string;
  usage: Usage;
  model: string;
};

export type ChatOptions = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Force a JSON object response (used by the analysis step). */
  jsonMode?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(options: ChatOptions): Promise<ChatResult> {
  if (!API_KEY) {
    throw new HttpError(
      500,
      "OPENAI_API_KEY is not configured on the server.",
      "openai_not_configured",
    );
  }

  const model = options.model ?? DEFAULT_MODEL;

  // deno-lint-ignore no-explicit-any
  const payload: Record<string, any> = {
    model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    max_completion_tokens: options.maxTokens ?? 8000,
  };

  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.jsonMode) payload.response_format = { type: "json_object" };

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        const data = await response.json();
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        const finishReason: string = data?.choices?.[0]?.finish_reason ?? "";

        if (!content.trim()) {
          lastError = "The model returned an empty response.";
          if (attempt < MAX_ATTEMPTS) {
            await sleep(attempt * 1500);
            continue;
          }
          throw new HttpError(502, lastError, "openai_empty_response");
        }

        if (finishReason === "length") {
          console.warn("OpenAI response hit the token ceiling; output may be cut.");
        }

        return {
          content,
          usage: data?.usage ?? {},
          model: data?.model ?? model,
        };
      }

      const bodyText = await response.text();
      lastError = extractMessage(bodyText) || `OpenAI returned ${response.status}`;

      // A parameter this model does not accept: strip it and retry once.
      if (response.status === 400) {
        const stripped = stripUnsupportedParam(payload, bodyText);
        if (stripped) {
          console.warn(`Retrying without unsupported parameter: ${stripped}`);
          continue;
        }
        throw new HttpError(502, `OpenAI rejected the request: ${lastError}`, "openai_bad_request");
      }

      if (response.status === 401 || response.status === 403) {
        throw new HttpError(
          502,
          "The OpenAI API key was rejected. Check OPENAI_API_KEY.",
          "openai_unauthorized",
        );
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 2000);
          continue;
        }
        throw new HttpError(
          503,
          "The AI service is busy right now. Please try again in a moment.",
          "openai_unavailable",
        );
      }

      throw new HttpError(502, lastError, "openai_error");
    } catch (error) {
      if (error instanceof HttpError) throw error;

      const aborted = error instanceof DOMException && error.name === "AbortError";
      lastError = aborted
        ? "The AI request timed out."
        : error instanceof Error
        ? error.message
        : String(error);

      if (attempt < MAX_ATTEMPTS && !aborted) {
        await sleep(attempt * 2000);
        continue;
      }

      throw new HttpError(504, lastError, "openai_timeout");
    } finally {
      clearTimeout(timer);
    }
  }

  throw new HttpError(502, lastError || "OpenAI request failed", "openai_error");
}

/** Remove a parameter the model complained about. Returns its name, or null. */
// deno-lint-ignore no-explicit-any
function stripUnsupportedParam(payload: Record<string, any>, body: string): string | null {
  const lowered = body.toLowerCase();

  if (lowered.includes("temperature") && "temperature" in payload) {
    delete payload.temperature;
    return "temperature";
  }

  if (lowered.includes("max_completion_tokens") && "max_completion_tokens" in payload) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
    return "max_completion_tokens";
  }

  if (lowered.includes("max_tokens") && "max_completion_tokens" in payload) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
    return "max_tokens";
  }

  if (lowered.includes("response_format") && "response_format" in payload) {
    delete payload.response_format;
    return "response_format";
  }

  return null;
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? "";
  } catch {
    return body.slice(0, 300);
  }
}

/** Models like to wrap code in ```html fences. Remove them. */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/;
  const match = text.match(fence);
  if (match) text = match[1];

  // Fall back to trimming stray leading/trailing fences.
  text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
  return text.trim();
}

/** Parse JSON that may still be wrapped in prose or fences. */
export function parseJsonLoose<T>(raw: string): T {
  const cleaned = stripCodeFences(raw);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new HttpError(
      502,
      "The AI returned malformed JSON. Please try the analysis again.",
      "invalid_ai_json",
    );
  }
}
