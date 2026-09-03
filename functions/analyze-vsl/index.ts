/**
 * POST /functions/v1/analyze-vsl
 * Body: { projectId: string }
 *
 * Reads the project's VSL text, runs the strategic analysis through OpenAI
 * and stores the normalised brief on the project row. Both the sales page
 * and the quiz are later generated from this one brief.
 */
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { requireApproved } from "../_shared/supabase.ts";
import { chatCompletion, parseJsonLoose } from "../_shared/openai.ts";
import { ANALYSIS_SYSTEM, buildAnalysisPrompt } from "../_shared/prompts.ts";
import { normalizeAnalysis } from "../_shared/analysis.ts";

const MIN_CHARS = 200;
const MAX_CHARS = 120_000; // ~30k tokens of transcript
const DAILY_LIMIT = 40;

type Body = { projectId?: string };

Deno.serve(serveJson(async (req) => {
  const { userId, profile, db } = await requireApproved(req);
  const { projectId } = await readJson<Body>(req);

  if (!projectId || typeof projectId !== "string") {
    throw new HttpError(400, "projectId is required", "bad_request");
  }

  const { data: project, error } = await db
    .from("projects")
    .select("id, user_id, name, vsl_text, status")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, "db_error");
  if (!project) throw new HttpError(404, "Project not found", "not_found");

  const isOwner = project.user_id === userId;
  if (!isOwner && profile.role !== "admin") {
    throw new HttpError(403, "You do not have access to this project", "forbidden");
  }

  const text = (project.vsl_text ?? "").trim();
  if (text.length < MIN_CHARS) {
    throw new HttpError(
      400,
      `The VSL text is too short to analyse (minimum ${MIN_CHARS} characters).`,
      "text_too_short",
    );
  }

  // Simple per-user throttle so a runaway client cannot burn the API budget.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", project.user_id)
    .eq("status", "analyzed")
    .gte("analyzed_at", since);

  if ((count ?? 0) >= DAILY_LIMIT) {
    throw new HttpError(
      429,
      "Daily analysis limit reached. Please try again tomorrow.",
      "rate_limited",
    );
  }

  await db
    .from("projects")
    .update({ status: "analyzing", error_message: null })
    .eq("id", project.id);

  try {
    const truncated = text.slice(0, MAX_CHARS);

    const result = await chatCompletion({
      system: ANALYSIS_SYSTEM,
      user: buildAnalysisPrompt(truncated),
      temperature: 0.35,
      maxTokens: 8000,
      jsonMode: true,
    });

    const analysis = normalizeAnalysis(parseJsonLoose(result.content));

    if (!analysis.big_promise && !analysis.headline && analysis.benefits.length === 0) {
      throw new HttpError(
        502,
        "The analysis came back empty. Check that the uploaded text is a real VSL script.",
        "empty_analysis",
      );
    }

    const { data: updated, error: updateError } = await db
      .from("projects")
      .update({
        analysis,
        analysis_model: result.model,
        analyzed_at: new Date().toISOString(),
        status: "analyzed",
        error_message: null,
      })
      .eq("id", project.id)
      .select("id, name, status, analysis, analysis_model, analyzed_at, updated_at")
      .single();

    if (updateError) throw new HttpError(500, updateError.message, "db_error");

    return json({ project: updated, usage: result.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";

    await db
      .from("projects")
      .update({ status: "failed", error_message: message.slice(0, 500) })
      .eq("id", project.id);

    throw err;
  }
}));
