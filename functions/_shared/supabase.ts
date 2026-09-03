/**
 * Supabase clients + authentication guards for edge functions.
 *
 * Every function authenticates the caller from the Authorization header,
 * then does its data work with the service-role client. Approval status
 * is re-checked here on the server, never trusted from the browser.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { HttpError } from "./http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Projects on the new API key system expose SUPABASE_SECRET_KEY (sb_secret_...);
// legacy projects expose the service_role JWT. Either grants full access.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) are not configured",
  );
}

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected" | "suspended";
};

/** Service-role client: bypasses RLS. Never expose this key to a browser. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AuthContext = {
  userId: string;
  profile: Profile;
  db: SupabaseClient;
};

/** Validate the bearer token and load the caller's profile. */
export async function authenticate(req: Request): Promise<AuthContext> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    throw new HttpError(401, "Missing authorization header", "unauthenticated");
  }

  const db = adminClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);

  if (userError || !userData?.user) {
    throw new HttpError(401, "Invalid or expired session", "unauthenticated");
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, email, full_name, company, role, status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new HttpError(403, "Profile not found for this account", "no_profile");
  }

  return { userId: userData.user.id, profile: profile as Profile, db };
}

/** Caller must exist AND have been approved by an administrator. */
export async function requireApproved(req: Request): Promise<AuthContext> {
  const ctx = await authenticate(req);

  if (ctx.profile.status !== "approved") {
    throw new HttpError(
      403,
      ctx.profile.status === "pending"
        ? "Your account is awaiting administrator approval."
        : `Your account is ${ctx.profile.status}. Contact support for help.`,
      "not_approved",
    );
  }

  return ctx;
}

/** Caller must be an approved administrator. */
export async function requireAdmin(req: Request): Promise<AuthContext> {
  const ctx = await requireApproved(req);

  if (ctx.profile.role !== "admin") {
    throw new HttpError(403, "Administrator access required", "forbidden");
  }

  return ctx;
}

/** Best-effort audit trail for privileged actions. */
export async function writeAuditLog(
  db: SupabaseClient,
  entry: {
    actorId: string;
    actorEmail: string;
    action: string;
    targetType?: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("audit_logs").insert({
    actor_id: entry.actorId,
    actor_email: entry.actorEmail,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) console.error("audit log failed:", error.message);
}
