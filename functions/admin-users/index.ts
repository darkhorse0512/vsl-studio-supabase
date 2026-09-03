/**
 * POST /functions/v1/admin-users
 * Body: { action, userId, ...payload }
 *
 * Every privileged mutation on a user account. Reads are handled by RLS in
 * the admin app; writes go through here so they can be validated, guarded
 * against privilege mistakes, and written to the audit log.
 *
 * Actions: approve | reject | suspend | reinstate | set_role | set_notes | delete_user
 */
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { requireAdmin, writeAuditLog } from "../_shared/supabase.ts";

type Action =
  | "approve"
  | "reject"
  | "suspend"
  | "reinstate"
  | "set_role"
  | "set_notes"
  | "delete_user";

type Body = {
  action?: Action;
  userId?: string;
  role?: "user" | "admin";
  notes?: string;
};

const PROFILE_COLUMNS =
  "id, email, full_name, company, role, status, approved_at, approved_by, notes, created_at, updated_at";

Deno.serve(serveJson(async (req) => {
  const { userId: actorId, profile: actor, db } = await requireAdmin(req);
  const body = await readJson<Body>(req);
  const { action, userId } = body;

  if (!action) throw new HttpError(400, "action is required", "bad_request");
  if (!userId || typeof userId !== "string") {
    throw new HttpError(400, "userId is required", "bad_request");
  }

  const { data: target, error: targetError } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (targetError) throw new HttpError(500, targetError.message, "db_error");
  if (!target) throw new HttpError(404, "User not found", "not_found");

  const isSelf = target.id === actorId;

  /** Never let the last remaining administrator be removed or locked out. */
  const assertNotLastAdmin = async () => {
    if (target.role !== "admin") return;

    const { count, error } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "approved");

    if (error) throw new HttpError(500, error.message, "db_error");
    if ((count ?? 0) <= 1) {
      throw new HttpError(
        409,
        "This is the last active administrator. Promote another admin first.",
        "last_admin",
      );
    }
  };

  // deno-lint-ignore no-explicit-any
  let patch: Record<string, any> = {};
  const auditAction: string = action;
  let auditMeta: Record<string, unknown> = {};

  switch (action) {
    case "approve":
      patch = {
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: actorId,
      };
      break;

    case "reject":
      if (isSelf) throw new HttpError(409, "You cannot reject your own account", "self_action");
      await assertNotLastAdmin();
      patch = { status: "rejected" };
      break;

    case "suspend":
      if (isSelf) throw new HttpError(409, "You cannot suspend your own account", "self_action");
      await assertNotLastAdmin();
      patch = { status: "suspended" };
      break;

    case "reinstate":
      patch = {
        status: "approved",
        approved_at: target.approved_at ?? new Date().toISOString(),
        approved_by: target.approved_by ?? actorId,
      };
      break;

    case "set_role": {
      const role = body.role;
      if (role !== "user" && role !== "admin") {
        throw new HttpError(400, "role must be 'user' or 'admin'", "bad_request");
      }
      if (isSelf && role === "user") {
        throw new HttpError(409, "You cannot remove your own admin access", "self_action");
      }
      if (role === "user") await assertNotLastAdmin();

      patch = role === "admin"
        ? {
          role,
          status: "approved",
          approved_at: target.approved_at ?? new Date().toISOString(),
          approved_by: target.approved_by ?? actorId,
        }
        : { role };

      auditMeta = { role };
      break;
    }

    case "set_notes":
      patch = { notes: (body.notes ?? "").slice(0, 2000) || null };
      break;

    case "delete_user": {
      if (isSelf) throw new HttpError(409, "You cannot delete your own account", "self_action");
      await assertNotLastAdmin();

      const { error: deleteError } = await db.auth.admin.deleteUser(userId);
      if (deleteError) throw new HttpError(500, deleteError.message, "delete_failed");

      await writeAuditLog(db, {
        actorId,
        actorEmail: actor.email,
        action: "delete_user",
        targetType: "user",
        targetId: userId,
        metadata: { email: target.email },
      });

      return json({ deleted: true, userId });
    }

    default:
      throw new HttpError(400, `Unknown action: ${action}`, "bad_request");
  }

  const { data: updated, error: updateError } = await db
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (updateError) throw new HttpError(500, updateError.message, "db_error");

  await writeAuditLog(db, {
    actorId,
    actorEmail: actor.email,
    action: auditAction,
    targetType: "user",
    targetId: userId,
    metadata: { email: target.email, ...auditMeta },
  });

  return json({ profile: updated });
}));
