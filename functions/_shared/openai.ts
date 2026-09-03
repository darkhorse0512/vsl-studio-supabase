/**
 * Resilient OpenAI client covering both APIs.
 *
 *   Chat Completions (/v1/chat/completions) - gpt-4.x, gpt-5.x
 *   Responses       (/v1/responses)         - the codex models, which are
 *                                             NOT served by chat/completions
 *
 * The endpoint is picked from the model name, so callers just name a model.
 *
 * Also handles the three things that actually break in production:
 *   1. transient 429 / 5xx            -> exponential backoff
 *   2. model-specific parameter rejections (temperature, token field)
 *                                     -> retry once without the offender
 *   3. runaway requests               -> hard timeout via AbortController
 */
import { HttpError } from "./http.ts";

const API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const BASE_URL = (Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1")
  .replace(/\/$/, "");

/** Analysis: cheap, fast, strong at structured JSON. */
export const DEFAULT_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1";

/** Asset generation: the best available coding model. */
export const CODE_MODEL = Deno.env.get("OPENAI_CODE_MODEL") ?? "gpt-5.3-codex";

/** none | low | medium | high | xhigh - higher costs latency. */
const REASONING_EFFORT = Deno.env.get("OPENAI_REASONING_EFFORT") ?? "medium";

const REQUEST_TIMEOUT_MS = Number(Deno.env.get("OPENAI_TIMEOUT_MS") ?? 170_000);
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

/** Codex models are only served by the Responses API. */
function usesResponsesApi(model: string): boolean {
  return /codex/i.test(model);
}

/** Reasoning-family models reject a custom temperature. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1345])/i.test(model);
}

export async function chatCompletion(options: ChatOptions): Promise<ChatResult> {
  if (!API_KEY) {
    throw new HttpError(
      500,
      "OPENAI_API_KEY is not configured on the server.",
      "openai_not_configured",
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const responsesApi = usesResponsesApi(model);
  const endpoint = responsesApi ? `${BASE_URL}/responses` : `${BASE_URL}/chat/completions`;
  const maxTokens = options.maxTokens ?? 8000;

  // deno-lint-ignore no-explicit-any
  let payload: Record<string, any>;

  if (responsesApi) {
    payload = {
      model,
      instructions: options.system,
      input: options.user,
      max_output_tokens: maxTokens,
      reasoning: { effort: REASONING_EFFORT },
    };
    if (options.jsonMode) payload.text = { format: { type: "json_object" } };
  } else {
    payload = {
      model,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      max_completion_tokens: maxTokens,
    };

    // Only classic models accept a custom temperature; sending one to a
    // reasoning model just burns a request on a 400.
    if (options.temperature !== undefined && !isReasoningModel(model)) {
      payload.temperature = options.temperature;
    }
    if (isReasoningModel(model)) payload.reasoning_effort = REASONING_EFFORT;
    if (options.jsonMode) payload.response_format = { type: "json_object" };
  }

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
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
        const content = extractContent(data);
        const finishReason = responsesApi
          ? data?.status ?? ""
          : data?.choices?.[0]?.finish_reason ?? "";

        if (!content.trim()) {
          lastError = "The model returned an empty response.";
          if (attempt < MAX_ATTEMPTS) {
            await sleep(attempt * 1500);
            continue;
          }
          throw new HttpError(502, lastError, "openai_empty_response");
        }

        if (finishReason === "length" || finishReason === "incomplete") {
          console.warn("OpenAI response hit the token ceiling; output may be cut.");
        }

        return {
          content,
          usage: normalizeUsage(data),
          model: data?.model ?? model,
        };
      }

      const bodyText = await response.text();
      lastError = extractMessage(bodyText) || `OpenAI returned ${response.status}`;

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

      if (response.status === 404) {
        throw new HttpError(
          502,
          `The model "${model}" is not available on this API key.`,
          "openai_model_unavailable",
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
        ? "The AI request timed out. Try again, or lower OPENAI_REASONING_EFFORT."
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

/* ------------------------------------------------------------------ */
/* Response shapes                                                     */
/* ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
function extractContent(data: any): string {
  // Chat Completions
  const chat = data?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat) return chat;

  // Responses API convenience field
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;

  // Responses API long form: output[] -> content[] -> text
  if (Array.isArray(data?.output)) {
    const text = data.output
      // deno-lint-ignore no-explicit-any
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      // deno-lint-ignore no-explicit-any
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
    if (text) return text;
  }

  return "";
}

// deno-lint-ignore no-explicit-any
function normalizeUsage(data: any): Usage {
  const usage = data?.usage ?? {};
  return {
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens,
  };
}

/** Remove a parameter the model complained about. Returns its name, or null. */
// deno-lint-ignore no-explicit-any
function stripUnsupportedParam(payload: Record<string, any>, body: string): string | null {
  const lowered = body.toLowerCase();

  if (lowered.includes("temperature") && "temperature" in payload) {
    delete payload.temperature;
    return "temperature";
  }

  if (lowered.includes("reasoning") && ("reasoning" in payload || "reasoning_effort" in payload)) {
    delete payload.reasoning;
    delete payload.reasoning_effort;
    return "reasoning";
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
