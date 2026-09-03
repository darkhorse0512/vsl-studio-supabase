/**
 * POST /functions/v1/generate-asset
 * Body: { projectId: string, type: "sales_page" | "quiz" }
 *
 * Generates a self-contained HTML asset from the project's stored analysis.
 * Both asset types read the SAME analysis object, which is what guarantees
 * the sales page and the quiz stay consistent with one another.
 */
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { requireApproved } from "../_shared/supabase.ts";
import { chatCompletion, stripCodeFences } from "../_shared/openai.ts";
import {
  buildAdaptationBrief,
  buildQuizPrompt,
  buildSalesPagePrompt,
  QUIZ_SYSTEM,
  SALES_PAGE_SYSTEM,
} from "../_shared/prompts.ts";
import {
  applySettings,
  normalizeAnalysis,
  normalizeSettings,
  type VslAnalysis,
} from "../_shared/analysis.ts";

type AssetType = "sales_page" | "quiz";
type Body = { projectId?: string; type?: AssetType };

const DAILY_LIMIT = 60;

const CONFIG: Record<AssetType, {
  system: string;
  prompt: (a: VslAnalysis, adaptation: string) => string;
  temperature: number;
  maxTokens: number;
  title: (a: VslAnalysis) => string;
  requiresScript: boolean;
}> = {
  sales_page: {
    system: SALES_PAGE_SYSTEM,
    prompt: buildSalesPagePrompt,
    temperature: 0.75,
    maxTokens: 24000,
    title: (a) => a.headline || a.big_promise || a.offer_name,
    requiresScript: false,
  },
  quiz: {
    system: QUIZ_SYSTEM,
    prompt: buildQuizPrompt,
    temperature: 0.65,
    maxTokens: 20000,
    title: (a) => a.quiz_blueprint.title || `${a.offer_name} quiz`,
    requiresScript: true,
  },
};

Deno.serve(serveJson(async (req) => {
  const { userId, profile, db } = await requireApproved(req);
  const { projectId, type } = await readJson<Body>(req);

  if (!projectId || typeof projectId !== "string") {
    throw new HttpError(400, "projectId is required", "bad_request");
  }
  if (type !== "sales_page" && type !== "quiz") {
    throw new HttpError(400, "type must be 'sales_page' or 'quiz'", "bad_request");
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
    throw new HttpError(
      409,
      "Run the VSL analysis before generating assets.",
      "analysis_missing",
    );
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

  // The source analysis, the operator's target-product overrides, and the
  // adapted brief that both asset types are generated from. Because the
  // settings live on the project, the sales page and the quiz always receive
  // an identical brief - the consistency guarantee survives the adaptation.
  const source = normalizeAnalysis(project.analysis);
  const settings = normalizeSettings(project.generation_settings);
  const analysis = applySettings(source, settings);
  const adaptation = buildAdaptationBrief(settings, source);

  const config = CONFIG[type];

  const result = await chatCompletion({
    system: config.system,
    user: config.prompt(analysis, adaptation),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });

  const code = stripCodeFences(result.content);
  assertUsableHtml(code, config.requiresScript);

  const { data: asset, error: insertError } = await db
    .from("assets")
    .insert({
      project_id: project.id,
      user_id: project.user_id,
      type,
      title: config.title(analysis).slice(0, 200),
      code,
      model: result.model,
      prompt_tokens: result.usage.prompt_tokens ?? null,
      completion_tokens: result.usage.completion_tokens ?? null,
    })
    .select("id, project_id, type, version, title, code, model, created_at")
    .single();

  if (insertError) throw new HttpError(500, insertError.message, "db_error");

  return json({ asset, usage: result.usage });
}));

/** Reject obviously broken output before it reaches the user's preview. */
function assertUsableHtml(code: string, requiresScript: boolean): void {
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

  if (requiresScript && !lowered.includes("<script")) {
    throw new HttpError(
      502,
      "The generated quiz has no JavaScript and would not be interactive. Please try again.",
      "invalid_quiz",
    );
  }

  if (code.length < 1500) {
    throw new HttpError(
      502,
      "The generated document was unusually short. Please try again.",
      "output_too_short",
    );
  }
}
