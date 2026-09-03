/**
 * The VslAnalysis object is the single source of truth for BOTH generated
 * assets. The sales page and the quiz are rendered from this exact object,
 * which is what guarantees that promise, audience, pains, desires, mechanism
 * and offer stay consistent between them.
 *
 * Whatever the model returns is normalised here so downstream code can rely
 * on every field existing with the right shape.
 */

export type NamedItem = { title: string; description: string };

export type VslAnalysis = {
  language: string;
  offer_name: string;
  product_type: string;
  big_promise: string;
  headline: string;
  subheadline: string;
  target_audience: {
    summary: string;
    demographics: string[];
    psychographics: string[];
    awareness_level: string;
  };
  pain_points: NamedItem[];
  desires: NamedItem[];
  unique_mechanism: {
    name: string;
    explanation: string;
    why_it_works: string;
  };
  benefits: NamedItem[];
  solution: {
    name: string;
    description: string;
    steps: NamedItem[];
  };
  offer: {
    summary: string;
    deliverables: { name: string; description: string; value: string }[];
    bonuses: { name: string; description: string; value: string }[];
    price: string;
    payment_options: string;
    guarantee: string;
    scarcity: string;
  };
  objections: { objection: string; response: string }[];
  proof: {
    testimonials: { quote: string; author: string; result: string }[];
    credentials: string[];
    stats: string[];
  };
  faq: { question: string; answer: string }[];
  cta: {
    primary_label: string;
    secondary_label: string;
    supporting_line: string;
    url: string;
  };
  tone: { voice: string; notes: string[] };
  brand: {
    primary_color: string;
    accent_color: string;
    background_color: string;
    text_color: string;
  };
  quiz_blueprint: {
    title: string;
    subtitle: string;
    promise: string;
    outcomes: { name: string; description: string; recommendation: string }[];
  };
};

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

const str = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
};

const strList = (value: unknown, limit = 12): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "string"
        ? item.trim()
        : str((item as Record<string, unknown>)?.title) ||
          str((item as Record<string, unknown>)?.name) ||
          str((item as Record<string, unknown>)?.text)
    )
    .filter(Boolean)
    .slice(0, limit);
};

/**
 * Map a loose array of objects onto a fixed set of string keys, accepting a
 * list of aliases per key. Returns plain string records; call sites assign
 * them to the concrete field types declared on VslAnalysis.
 */
// deno-lint-ignore no-explicit-any
const objList = (
  value: unknown,
  shape: Record<string, string[]>,
  limit = 12,
): any[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw) => {
      const source: Record<string, unknown> = typeof raw === "string"
        ? { title: raw }
        : ((raw ?? {}) as Record<string, unknown>);
      const out = {} as Record<string, string>;

      for (const [key, aliases] of Object.entries(shape)) {
        let found = "";
        for (const alias of [key, ...aliases]) {
          const candidate = str(source[alias]);
          if (candidate) {
            found = candidate;
            break;
          }
        }
        out[key] = found;
      }
      return out;
    })
    .filter((item) => Object.values(item).some(Boolean))
    .slice(0, limit);
};

const hexColor = (value: unknown, fallback: string): string => {
  const candidate = str(value);
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate) ? candidate : fallback;
};

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
export function normalizeAnalysis(raw: any): VslAnalysis {
  const input = raw && typeof raw === "object" ? raw : {};
  const audience = input.target_audience ?? {};
  const mechanism = input.unique_mechanism ?? {};
  const solution = input.solution ?? {};
  const offer = input.offer ?? {};
  const proof = input.proof ?? {};
  const cta = input.cta ?? {};
  const tone = input.tone ?? {};
  const brand = input.brand ?? {};
  const quiz = input.quiz_blueprint ?? input.quiz ?? {};

  return {
    language: str(input.language, "en") || "en",
    offer_name: str(input.offer_name) || str(input.product_name) || "Untitled Offer",
    product_type: str(input.product_type),
    big_promise: str(input.big_promise) || str(input.promise),
    headline: str(input.headline),
    subheadline: str(input.subheadline) || str(input.sub_headline),

    target_audience: {
      summary: str(audience.summary) || str(input.audience),
      demographics: strList(audience.demographics, 8),
      psychographics: strList(audience.psychographics, 8),
      awareness_level: str(audience.awareness_level),
    },

    pain_points: objList(input.pain_points ?? input.pains, {
      title: ["name", "pain", "headline"],
      description: ["detail", "text", "body"],
    }),

    desires: objList(input.desires ?? input.dreams, {
      title: ["name", "desire", "headline"],
      description: ["detail", "text", "body"],
    }),

    unique_mechanism: {
      name: str(mechanism.name) || str(mechanism.title),
      explanation: str(mechanism.explanation) || str(mechanism.description),
      why_it_works: str(mechanism.why_it_works) || str(mechanism.why),
    },

    benefits: objList(input.benefits, {
      title: ["name", "benefit", "headline"],
      description: ["detail", "text", "body"],
    }),

    solution: {
      name: str(solution.name) || str(solution.title),
      description: str(solution.description) || str(solution.summary),
      steps: objList(solution.steps ?? solution.how_it_works, {
        title: ["name", "step", "headline"],
        description: ["detail", "text", "body"],
      }, 8),
    },

    offer: {
      summary: str(offer.summary) || str(offer.description),
      deliverables: objList(offer.deliverables ?? offer.includes, {
        name: ["title", "item"],
        description: ["detail", "text"],
        value: ["price", "worth"],
      }, 10),
      bonuses: objList(offer.bonuses, {
        name: ["title", "item"],
        description: ["detail", "text"],
        value: ["price", "worth"],
      }, 10),
      price: str(offer.price),
      payment_options: str(offer.payment_options) || str(offer.payment),
      guarantee: str(offer.guarantee) || str(offer.risk_reversal),
      scarcity: str(offer.scarcity) || str(offer.urgency),
    },

    objections: objList(input.objections, {
      objection: ["question", "title", "concern"],
      response: ["answer", "reply", "rebuttal"],
    }, 10),

    proof: {
      testimonials: objList(proof.testimonials ?? input.testimonials, {
        quote: ["text", "body", "testimonial"],
        author: ["name", "who"],
        result: ["outcome", "detail"],
      }, 8),
      credentials: strList(proof.credentials, 8),
      stats: strList(proof.stats ?? proof.statistics, 8),
    },

    faq: objList(input.faq ?? input.faqs, {
      question: ["q", "title"],
      answer: ["a", "response", "body"],
    }, 12),

    cta: {
      primary_label: str(cta.primary_label) || str(cta.primary) || "Get Started",
      secondary_label: str(cta.secondary_label) || str(cta.secondary),
      supporting_line: str(cta.supporting_line) || str(cta.next_step),
      url: str(cta.url) || "#offer",
    },

    tone: {
      voice: str(tone.voice) || str(input.tone_of_voice),
      notes: strList(tone.notes ?? tone.style_notes, 8),
    },

    brand: {
      primary_color: hexColor(brand.primary_color ?? brand.primary, "#4f46e5"),
      accent_color: hexColor(brand.accent_color ?? brand.accent, "#f59e0b"),
      background_color: hexColor(brand.background_color ?? brand.background, "#ffffff"),
      text_color: hexColor(brand.text_color ?? brand.text, "#0f172a"),
    },

    quiz_blueprint: {
      title: str(quiz.title),
      subtitle: str(quiz.subtitle),
      promise: str(quiz.promise) || str(quiz.hook),
      outcomes: objList(quiz.outcomes ?? quiz.segments ?? quiz.results, {
        name: ["title", "label"],
        description: ["detail", "text", "summary"],
        recommendation: ["advice", "next_step", "cta"],
      }, 6),
    },
  };
}

/** Compact, deterministic brief handed to both generators. */
export function analysisBrief(analysis: VslAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}
