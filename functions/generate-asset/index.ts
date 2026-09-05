/**
 * POST /functions/v1/generate-asset
 * Body: { projectId, type: "sales_page" | "quiz" | "product" | "ad_creative" }
 *
 * Every asset is generated from the SAME analysis + target-product settings,
 * which is what keeps the sales page, the quiz, the deliverable and the ad
 * creative telling one consistent story.
 *
 * The prompt itself comes from the template registry, so an administrator can
 * rewrite any of them from the admin panel without a deploy.
 */
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { requireApproved } from "../_shared/supabase.ts";
import { CODE_MODEL, chatCompletion, stripCodeFences } from "../_shared/openai.ts";
import {
  analysisBrief,
  buildAdaptationBrief,
  buildStyleDirection,
  SHARED_BUILD_RULES,
} from "../_shared/prompts.ts";
import {
  applySettings,
  normalizeAnalysis,
  normalizeSettings,
} from "../_shared/analysis.ts";
import { renderTemplate, resolveTemplate, type TemplateId } from "../_shared/templates.ts";

const ASSET_TYPES = ["sales_page", "quiz", "product", "ad_creative"] as const;
type AssetType = (typeof ASSET_TYPES)[number];

type Body = { projectId?: string; type?: AssetType };

const DAILY_LIMIT = 60;

Deno.serve(serveJson(async (req) => {
  const { userId, profile, db } = await requireApproved(req);
  const { projectId, type } = await readJson<Body>(req);

  if (!projectId || typeof projectId !== "string") {
    throw new HttpError(400, "projectId is required", "bad_request");
  }
  if (!type || !ASSET_TYPES.includes(type)) {
    throw new HttpError(400, `type must be one of: ${ASSET_TYPES.join(", ")}`, "bad_request");
  }

  const { data: project, error } = await db
    .from("projects")
    .select("id, user_id, name, status, analysis, generation_settings")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, "db_error");
  if (!project) throw new HttpError(404, "Project not found", "not_found");

  if (project.user_id !== userId && profile.role !== "admin") {
    throw new HttpError(403, "You do not have access to this project", "forbidden");
  }

  if (!project.analysis) {
    throw new HttpError(409, "Run the VSL analysis before generating assets.", "analysis_missing");
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", project.user_id)
    .gte("created_at", since);

  if ((count ?? 0) >= DAILY_LIMIT) {
    throw new HttpError(
      429,
      "Daily generation limit reached. Please try again tomorrow.",
      "rate_limited",
    );
  }

  // Source analysis + operator overrides -> one adapted brief shared by all
  // four generators.
  const source = normalizeAnalysis(project.analysis);
  const settings = normalizeSettings(project.generation_settings);
  const analysis = applySettings(source, settings);

  const template = await resolveTemplate(db, type as TemplateId);

  const userPrompt = renderTemplate(template.user, {
    ADAPTATION: buildAdaptationBrief(settings, source),
    STYLE: buildStyleDirection(settings),
    BUILD_RULES: SHARED_BUILD_RULES,
    ANALYSIS_JSON: analysisBrief(analysis),
  });

  const result = await chatCompletion({
    system: template.system,
    user: userPrompt,
    model: template.model || CODE_MODEL,
    temperature: template.temperature ?? undefined,
    maxTokens: template.maxTokens,
    reasoningEffort: template.reasoningEffort || undefined,
  });

  const code = template.outputKind === "markdown"
    ? cleanMarkdown(result.content)
    : stripCodeFences(result.content);

  assertUsable(code, type, template.outputKind);

  const { data: asset, error: insertError } = await db
    .from("assets")
    .insert({
      project_id: project.id,
      user_id: project.user_id,
      type,
      title: assetTitle(type, analysis).slice(0, 200),
      code,
      model: result.model,
      prompt_tokens: result.usage.prompt_tokens ?? null,
      completion_tokens: result.usage.completion_tokens ?? null,
    })
    .select("id, project_id, type, version, title, code, model, created_at")
    .single();

  if (insertError) throw new HttpError(500, insertError.message, "db_error");

  return json({ asset, usage: result.usage, promptOverridden: template.overridden });
}));

/* ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
function assetTitle(type: AssetType, analysis: any): string {
  switch (type) {
    case "quiz":
      return analysis.quiz_blueprint?.title || `${analysis.offer_name} quiz`;
    case "product":
      return analysis.offer_name || analysis.solution?.name || "Product";
    case "ad_creative":
      return `${analysis.offer_name} - ad creative`;
    default:
      return analysis.headline || analysis.big_promise || analysis.offer_name;
  }
}

/** The markdown asset only needs its outer fence removed, if present. */
function cleanMarkdown(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : text).trim();
}

/** Reject obviously broken output before it reaches the user's preview. */
function assertUsable(code: string, type: AssetType, kind: string): void {
  if (code.length < 800) {
    throw new HttpError(
      502,
      "The generated document was unusually short. Please try again.",
      "output_too_short",
    );
  }

  if (kind === "markdown") {
    // An image-prompt package that came back as a web page is a failure.
    if (/^\s*<!doctype html/i.test(code) || /<html[\s>]/i.test(code)) {
      throw new HttpError(
        502,
        "The ad creative came back as HTML instead of text. Please try again.",
        "invalid_markdown",
      );
    }
    if (!code.includes("#")) {
      throw new HttpError(
        502,
        "The ad creative is missing its sections. Please try again.",
        "invalid_markdown",
      );
    }
    return;
  }

  const lowered = code.toLowerCase();

  if (!lowered.includes("<html") || !lowered.includes("</html>")) {
    throw new HttpError(
      502,
      "The AI did not return a complete HTML document. Please try again.",
      "invalid_html",
    );
  }

  if (!lowered.includes("<body") || !lowered.includes("</body>")) {
    throw new HttpError(
      502,
      "The generated document is missing its body. Please try again.",
      "invalid_html",
    );
  }

  if (type === "quiz" && !lowered.includes("<script")) {
    throw new HttpError(
      502,
      "The generated quiz has no JavaScript and would not be interactive. Please try again.",
      "invalid_quiz",
    );
  }

  if (type === "product" && !lowered.includes("@page") && !lowered.includes("@media print")) {
    throw new HttpError(
      502,
      "The product was generated without print styles, so it would not export cleanly to PDF. Please try again.",
      "invalid_product",
    );
  }
}
