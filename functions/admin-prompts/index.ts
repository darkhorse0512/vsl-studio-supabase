/**
 * POST /functions/v1/admin-prompts
 * Body: { action: "list" | "save" | "reset", ... }
 *
 * Lets an administrator read and rewrite every generator prompt from the
 * panel. The code default is always returned alongside the override, so the
 * editor can show what ships, what changed, and restore it in one click.
 *
 * Only overrides are stored. Deleting one restores the default immediately -
 * no deploy, and no way to permanently lose the shipped prompt.
 */
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { requireAdmin, writeAuditLog } from "../_shared/supabase.ts";
import { CODE_MODEL, DEFAULT_MODEL } from "../_shared/openai.ts";
import {
  resolveAll,
  TEMPLATE_DEFAULTS,
  TEMPLATE_IDS,
  type TemplateId,
} from "../_shared/templates.ts";

type Body = {
  action?: "list" | "save" | "reset";
  id?: string;
  system_prompt?: string;
  user_prompt?: string;
  model?: string;
  temperature?: number | null;
  max_tokens?: number | null;
  reasoning_effort?: string;
};

const EFFORTS = ["", "none", "low", "medium", "high", "xhigh"];
const MAX_PROMPT_CHARS = 40_000;

Deno.serve(serveJson(async (req) => {
  const { userId: actorId, profile: actor, db } = await requireAdmin(req);
  const body = await readJson<Body>(req);
  const action = body.action ?? "list";

  if (action === "list") {
    return json({
      templates: await resolveAll(db),
      models: { analysis: DEFAULT_MODEL, assets: CODE_MODEL },
      efforts: EFFORTS.filter(Boolean),
    });
  }

  const id = body.id as TemplateId;
  if (!id || !TEMPLATE_IDS.includes(id)) {
    throw new HttpError(400, `id must be one of: ${TEMPLATE_IDS.join(", ")}`, "bad_request");
  }

  /* ---------------------------------------------------------------- */
  /* Reset - drop the override, the default takes over again           */
  /* ---------------------------------------------------------------- */
  if (action === "reset") {
    const { error } = await db.from("prompt_overrides").delete().eq("id", id);
    if (error) throw new HttpError(500, error.message, "db_error");

    await writeAuditLog(db, {
      actorId,
      actorEmail: actor.email,
      action: "prompt_reset",
      targetType: "prompt",
      metadata: { id },
    });

    return json({ reset: true, id, templates: await resolveAll(db) });
  }

  /* ---------------------------------------------------------------- */
  /* Save                                                              */
  /* ---------------------------------------------------------------- */
  if (action !== "save") {
    throw new HttpError(400, `Unknown action: ${action}`, "bad_request");
  }

  const systemPrompt = (body.system_prompt ?? "").trim();
  const userPrompt = (body.user_prompt ?? "").trim();

  if (!systemPrompt || !userPrompt) {
    throw new HttpError(
      400,
      "Both the system prompt and the user prompt are required. Use reset to restore the default.",
      "bad_request",
    );
  }

  if (systemPrompt.length > MAX_PROMPT_CHARS || userPrompt.length > MAX_PROMPT_CHARS) {
    throw new HttpError(
      400,
      `A prompt cannot exceed ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
      "prompt_too_long",
    );
  }

  // A template that drops the dynamic input would silently produce garbage,
  // so the placeholders that carry the actual project data are mandatory.
  const required = id === "analysis" ? ["{{VSL_TEXT}}"] : ["{{ANALYSIS_JSON}}"];
  const missing = required.filter((token) => !userPrompt.includes(token));

  if (missing.length) {
    throw new HttpError(
      400,
      `The user prompt must still contain ${missing.join(", ")} — without it the model never receives the project's data.`,
      "missing_placeholder",
    );
  }

  const effort = (body.reasoning_effort ?? "").trim();
  if (effort && !EFFORTS.includes(effort)) {
    throw new HttpError(400, `reasoning_effort must be one of: ${EFFORTS.filter(Boolean).join(", ")}`, "bad_request");
  }

  const temperature = body.temperature === null || body.temperature === undefined
    ? null
    : Number(body.temperature);

  if (temperature !== null && (Number.isNaN(temperature) || temperature < 0 || temperature > 2)) {
    throw new HttpError(400, "temperature must be between 0 and 2", "bad_request");
  }

  const maxTokens = body.max_tokens === null || body.max_tokens === undefined
    ? null
    : Number(body.max_tokens);

  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 500 || maxTokens > 64000)) {
    throw new HttpError(400, "max_tokens must be between 500 and 64000", "bad_request");
  }

  const defaults = TEMPLATE_DEFAULTS[id];

  const { error } = await db.from("prompt_overrides").upsert({
    id,
    system_prompt: systemPrompt === defaults.system ? null : systemPrompt,
    user_prompt: userPrompt === defaults.user ? null : userPrompt,
    model: (body.model ?? "").trim() || null,
    temperature,
    max_tokens: maxTokens,
    reasoning_effort: effort || null,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  });

  if (error) throw new HttpError(500, error.message, "db_error");

  await writeAuditLog(db, {
    actorId,
    actorEmail: actor.email,
    action: "prompt_save",
    targetType: "prompt",
    metadata: { id, model: body.model ?? "", temperature, max_tokens: maxTokens },
  });

  return json({ saved: true, id, templates: await resolveAll(db) });
}));
