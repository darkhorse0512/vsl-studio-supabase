/**
 * Tiny HTTP helpers shared by every edge function: CORS, JSON responses
 * and a typed error that maps cleanly onto status codes.
 */

/**
 * Headers the browser is allowed to send. supabase-js adds `apikey`,
 * `authorization`, `x-client-info` and `content-type` on its own; this project
 * also sets `x-application-name` on the client. Anything the browser actually
 * asks for in the preflight is echoed back, so adding another custom header on
 * the client never requires a function redeploy again.
 */
const DEFAULT_ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-application-name, x-supabase-api-version";

/**
 * ALLOWED_ORIGIN may be "*" (default), a single origin, or a comma-separated
 * list. With a list, the caller's origin is echoed back when it matches.
 */
function resolveOrigin(req?: Request): string {
  const configured = (Deno.env.get("ALLOWED_ORIGIN") ?? "*").trim();
  if (!configured || configured === "*") return "*";

  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  const origin = req?.headers.get("origin") ?? "";

  return allowed.includes(origin) ? origin : allowed[0];
}

export function buildCorsHeaders(req?: Request): Record<string, string> {
  const requested = req?.headers.get("access-control-request-headers");

  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Headers": requested && requested.trim()
      ? requested
      : DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

/** Static fallback, used when no request is in scope. */
export const corsHeaders = buildCorsHeaders();

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
    headers: { "Content-Type": "application/json" },
  });
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

/**
 * Wrap a handler with CORS + uniform error handling.
 * CORS headers are applied here, to every response, so no individual handler
 * can forget them.
 */
export function serveJson(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: cors });
    }

    let response: Response;
    try {
      response = await handler(req);
    } catch (error) {
      response = toErrorResponse(error);
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);

    return new Response(response.body, { status: response.status, headers });
  };
}
