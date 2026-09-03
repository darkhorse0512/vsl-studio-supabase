/**
 * Tiny HTTP helpers shared by every edge function: CORS, JSON responses
 * and a typed error that maps cleanly onto status codes.
 */

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(): Response {
  return new Response("ok", { headers: corsHeaders });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, code: error.code, details: error.details },
      error.status,
    );
  }
  console.error("Unhandled edge function error:", error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  return json({ error: message, code: "internal_error" }, 500);
}

/** Parse and validate the JSON body of a POST request. */
export async function readJson<T>(req: Request): Promise<T> {
  if (req.method !== "POST") {
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "bad_request");
  }
}

/** Wrap a handler with CORS + uniform error handling. */
export function serveJson(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return preflight();
    try {
      return await handler(req);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
