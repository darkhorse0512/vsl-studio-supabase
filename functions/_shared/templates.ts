/**
 * Prompt template registry.
 *
 * The code holds the DEFAULT for every generator. The database holds only
 * the administrator's OVERRIDES (table: prompt_overrides). At request time
 * the two are merged, so:
 *
 *   - an admin can rewrite any prompt without a deploy,
 *   - deleting the override instantly restores the shipped default,
 *   - and a project that never touched the admin panel behaves exactly as
 *     it did before this table existed.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import {
  AD_CREATIVE_BODY,
  AD_CREATIVE_SYSTEM,
  ANALYSIS_BODY,
  ANALYSIS_SYSTEM,
  PRODUCT_BODY,
  PRODUCT_SYSTEM,
  QUIZ_BODY,
  QUIZ_SYSTEM,
  SALES_PAGE_BODY,
  SALES_PAGE_SYSTEM,
} from "./prompts.ts";

export type TemplateId = "analysis" | "sales_page" | "quiz" | "product" | "ad_creative";

export type OutputKind = "html" | "markdown" | "json";

export type TemplateDefinition = {
  id: TemplateId;
  label: string;
  description: string;
  /** Placeholders this template may use, surfaced in the admin editor. */
  placeholders: string[];
  system: string;
  user: string;
  temperature: number | null;
  maxTokens: number;
  /** Empty means "use the configured model for this kind of work". */
  model: string;
  reasoningEffort: string;
  outputKind: OutputKind;
};

const ANALYSIS_PLACEHOLDERS = ["{{SCHEMA}}", "{{VSL_TEXT}}"];
const ASSET_PLACEHOLDERS = [
  "{{ADAPTATION}}",
  "{{BUILD_RULES}}",
  "{{STYLE}}",
  "{{ANALYSIS_JSON}}",
];

export const TEMPLATE_DEFAULTS: Record<TemplateId, TemplateDefinition> = {
  analysis: {
    id: "analysis",
    label: "VSL analysis",
    description:
      "Reads the source transcript and returns the structured brief every other generator depends on. Must return valid JSON.",
    placeholders: ANALYSIS_PLACEHOLDERS,
    system: ANALYSIS_SYSTEM,
    user: ANALYSIS_BODY,
    temperature: 0.35,
    maxTokens: 8000,
    model: "",
    reasoningEffort: "",
    outputKind: "json",
  },

  sales_page: {
    id: "sales_page",
    label: "Sales page",
    description:
      "Long-form responsive sales page as one self-contained HTML file.",
    placeholders: ASSET_PLACEHOLDERS,
    system: SALES_PAGE_SYSTEM,
    user: SALES_PAGE_BODY,
    temperature: 0.75,
    maxTokens: 24000,
    model: "",
    reasoningEffort: "",
    outputKind: "html",
  },

  quiz: {
    id: "quiz",
    label: "Interactive quiz",
    description:
      "Multi-step quiz with weighted scoring and a personalised result, as one HTML file with vanilla JS.",
    placeholders: ASSET_PLACEHOLDERS,
    system: QUIZ_SYSTEM,
    user: QUIZ_BODY,
    temperature: 0.65,
    maxTokens: 20000,
    model: "",
    reasoningEffort: "",
    outputKind: "html",
  },

  product: {
    id: "product",
    label: "Product (PDF deliverable)",
    description:
      "The actual deliverable the buyer receives - recipe book, protocol or guide - laid out print-ready so the browser can save it as a PDF.",
    placeholders: ASSET_PLACEHOLDERS,
    system: PRODUCT_SYSTEM,
    user: PRODUCT_BODY,
    temperature: 0.7,
    maxTokens: 24000,
    model: "",
    reasoningEffort: "low",
    outputKind: "html",
  },

  ad_creative: {
    id: "ad_creative",
    label: "Ad creative",
    description:
      "Image prompts for another AI plus matching ad copy and overlay text. Returns markdown, not HTML.",
    placeholders: ASSET_PLACEHOLDERS,
    system: AD_CREATIVE_SYSTEM,
    user: AD_CREATIVE_BODY,
    temperature: 0.8,
    maxTokens: 10000,
    model: "",
    reasoningEffort: "",
    outputKind: "markdown",
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATE_DEFAULTS) as TemplateId[];

export type PromptOverride = {
  id: string;
  system_prompt: string | null;
  user_prompt: string | null;
  model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
  updated_at?: string;
};

/** A default merged with its override, ready to send to the model. */
export type ResolvedTemplate = TemplateDefinition & { overridden: boolean };

function merge(
  base: TemplateDefinition,
  override: PromptOverride | null | undefined,
): ResolvedTemplate {
  if (!override) return { ...base, overridden: false };

  const text = (value: string | null | undefined, fallback: string) => {
    const trimmed = (value ?? "").trim();
    return trimmed ? value as string : fallback;
  };

  return {
    ...base,
    system: text(override.system_prompt, base.system),
    user: text(override.user_prompt, base.user),
    model: text(override.model, base.model),
    reasoningEffort: text(override.reasoning_effort, base.reasoningEffort),
    temperature: override.temperature ?? base.temperature,
    maxTokens: override.max_tokens ?? base.maxTokens,
    overridden: true,
  };
}

/** Fetch every override in one round trip. */
export async function loadOverrides(
  db: SupabaseClient,
): Promise<Record<string, PromptOverride>> {
  const { data, error } = await db
    .from("prompt_overrides")
    .select("id, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, updated_at");

  if (error) {
    // A prompt problem must never take generation down - fall back to code.
    console.error("Could not load prompt overrides, using defaults:", error.message);
    return {};
  }

  const map: Record<string, PromptOverride> = {};
  for (const row of data ?? []) map[row.id] = row as PromptOverride;
  return map;
}

export async function resolveTemplate(
  db: SupabaseClient,
  id: TemplateId,
): Promise<ResolvedTemplate> {
  const overrides = await loadOverrides(db);
  return merge(TEMPLATE_DEFAULTS[id], overrides[id]);
}

/** Every default merged with its override - used by the admin listing. */
export async function resolveAll(db: SupabaseClient) {
  const overrides = await loadOverrides(db);

  return TEMPLATE_IDS.map((id) => ({
    id,
    label: TEMPLATE_DEFAULTS[id].label,
    description: TEMPLATE_DEFAULTS[id].description,
    placeholders: TEMPLATE_DEFAULTS[id].placeholders,
    outputKind: TEMPLATE_DEFAULTS[id].outputKind,
    defaults: {
      system_prompt: TEMPLATE_DEFAULTS[id].system,
      user_prompt: TEMPLATE_DEFAULTS[id].user,
      temperature: TEMPLATE_DEFAULTS[id].temperature,
      max_tokens: TEMPLATE_DEFAULTS[id].maxTokens,
      model: TEMPLATE_DEFAULTS[id].model,
      reasoning_effort: TEMPLATE_DEFAULTS[id].reasoningEffort,
    },
    override: overrides[id] ?? null,
  }));
}

/**
 * Substitute {{PLACEHOLDERS}}. Unknown placeholders are left untouched so a
 * typo in the admin panel is visible in the output rather than silently
 * deleting content.
 */
export function renderTemplate(
  template: string,
  context: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) =>
    key in context ? context[key] : match
  );
}
