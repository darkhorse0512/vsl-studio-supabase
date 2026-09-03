/**
 * Prompt library.
 *
 * One analysis -> two assets. The sales page and the quiz are both built
 * from the SAME VslAnalysis JSON, and both prompts are explicitly told to
 * treat that JSON as the only source of truth. That is what keeps the
 * promise, audience, pains, desires, mechanism and offer consistent.
 */
import {
  analysisBrief,
  type GenerationSettings,
  hasSettings,
  type VslAnalysis,
} from "./analysis.ts";

/* ==================================================================== */
/* 1. VSL analysis                                                      */
/* ==================================================================== */

export const ANALYSIS_SYSTEM = `You are a senior direct-response marketing strategist and copy analyst.
You dissect Video Sales Letter (VSL) scripts and return a rigorous, structured brief that other
copywriters can build an entire funnel from.

Rules you never break:
- Work ONLY from the transcript provided. Never invent testimonials, statistics, prices,
  guarantees or credentials that are not present or clearly implied in the text.
- If a field genuinely has no basis in the transcript, return an empty string or an empty array.
  Empty is always better than fabricated.
- Write every value in the SAME LANGUAGE as the transcript (if the VSL is in Portuguese, the whole
  brief is in Portuguese). Set "language" to that language's ISO 639-1 code.
- Be specific and concrete. Use the customer's own vocabulary and emotional register.
- Return valid JSON only. No markdown, no commentary.`;

const ANALYSIS_SCHEMA = `{
  "language": "ISO 639-1 code of the transcript, e.g. en, pt, es",
  "offer_name": "product or program name",
  "product_type": "e.g. online course, supplement, coaching program, SaaS",
  "big_promise": "the single biggest transformation promised, one sentence",
  "headline": "a punchy sales-page headline (max 14 words) built on the big promise",
  "subheadline": "a supporting sentence that adds specificity, mechanism or timeframe",
  "target_audience": {
    "summary": "who this is for, 1-2 sentences",
    "demographics": ["3-6 concrete traits"],
    "psychographics": ["3-6 beliefs, frustrations, identity markers"],
    "awareness_level": "unaware | problem-aware | solution-aware | product-aware | most-aware"
  },
  "pain_points": [{ "title": "short label", "description": "1-2 vivid sentences in the reader's voice" }],
  "desires": [{ "title": "short label", "description": "1-2 sentences describing the desired outcome" }],
  "unique_mechanism": {
    "name": "the branded mechanism / method name used or implied",
    "explanation": "how it works, 2-3 sentences",
    "why_it_works": "why it succeeds where other approaches fail"
  },
  "benefits": [{ "title": "benefit headline", "description": "the tangible result behind it" }],
  "solution": {
    "name": "the solution / product being sold",
    "description": "what the buyer actually gets and how it solves the pains",
    "steps": [{ "title": "step name", "description": "what happens in this step" }]
  },
  "offer": {
    "summary": "the offer in one paragraph",
    "deliverables": [{ "name": "", "description": "", "value": "stated value or empty string" }],
    "bonuses": [{ "name": "", "description": "", "value": "" }],
    "price": "exactly as stated in the VSL, or empty string",
    "payment_options": "instalments / plans mentioned, or empty string",
    "guarantee": "guarantee terms as stated, or empty string",
    "scarcity": "deadline, limited seats or bonus expiry, or empty string"
  },
  "objections": [{ "objection": "what the prospect thinks", "response": "the answer the VSL gives" }],
  "proof": {
    "testimonials": [{ "quote": "", "author": "", "result": "" }],
    "credentials": ["authority markers for the presenter"],
    "stats": ["numbers, studies or results cited"]
  },
  "faq": [{ "question": "", "answer": "" }],
  "cta": {
    "primary_label": "button text, action-oriented",
    "secondary_label": "secondary button text or empty string",
    "supporting_line": "the risk-reversal / reassurance line under the button",
    "url": "#offer"
  },
  "tone": { "voice": "e.g. urgent and empathetic mentor", "notes": ["style guidance for the copywriter"] },
  "brand": {
    "primary_color": "#RRGGBB fitting the niche",
    "accent_color": "#RRGGBB",
    "background_color": "#RRGGBB",
    "text_color": "#RRGGBB"
  },
  "quiz_blueprint": {
    "title": "an engaging quiz title built on the same promise",
    "subtitle": "one supporting sentence",
    "promise": "what the reader learns about themselves by finishing it",
    "outcomes": [{ "name": "result profile name", "description": "what this profile means", "recommendation": "the next step, which must lead to this offer" }]
  }
}`;

export function buildAnalysisPrompt(vslText: string): string {
  return `Analyse the following VSL transcript and return the brief as JSON.

Quantity guidance: 4-6 pain_points, 4-6 desires, 5-8 benefits, 3-5 objections, 5-8 faq entries,
3-4 quiz_blueprint.outcomes.

Return exactly this JSON shape (same keys, same nesting):
${ANALYSIS_SCHEMA}

=== VSL TRANSCRIPT START ===
${vslText}
=== VSL TRANSCRIPT END ===`;
}

/* ==================================================================== */
/* Shared craft rules for both generated assets                         */
/* ==================================================================== */

const SHARED_BUILD_RULES = `TECHNICAL RULES
- Output ONE complete, self-contained HTML5 document starting with <!DOCTYPE html>.
- All CSS in a single <style> block in <head>. No external stylesheets, no CDNs, no web fonts,
  no frameworks, no external images, no build step.
- Font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif.
- Mobile-first and fully responsive. Nothing may overflow horizontally at 320px.
- Accessible: semantic landmarks, exactly one <h1>, logical heading order, aria-labels where
  needed, visible :focus-visible rings, and at least 4.5:1 text contrast on every background.
- Set <html lang="..."> to the analysis "language" value and write ALL copy in that language.
- Decorative visuals must be pure CSS or inline SVG. Never reference an external image file.
- Never output lorem ipsum, TODOs, placeholder brackets, emoji-as-icons or commentary.

DESIGN SYSTEM - this page must look like a studio designed it, not like a default document.

Tokens. Define on :root and use them everywhere - never hard-code a colour twice:
  --brand / --brand-dark / --accent  from the analysis "brand" colours
  --ink (headings), --body (paragraphs, ~70% ink), --muted (meta text)
  --bg, --bg-alt (a barely-there tint for alternating sections), --surface (cards)
  --line (hairline borders), --radius: 14px, --radius-lg: 22px
  --shadow-sm / --shadow-md / --shadow-lg using soft, large-radius, low-opacity shadows
    (e.g. 0 18px 40px -20px rgba(15,23,42,.28)) - never a harsh black box-shadow
  --maxw: 1120px, --maxw-narrow: 720px for reading columns

Typography:
- Fluid type with clamp(): h1 clamp(2rem, 5.2vw, 3.6rem); h2 clamp(1.6rem, 3.4vw, 2.5rem);
  body 1.0625-1.125rem. Never below 16px for body text on mobile.
- Headings: line-height 1.12, letter-spacing -0.02em, font-weight 700-800, text-wrap: balance.
- Paragraphs: line-height 1.65-1.75, max-width ~68ch, text-wrap: pretty.
- Establish real hierarchy: eyebrow label (small, uppercase, letter-spaced, brand-coloured),
  then heading, then supporting paragraph. Use it consistently at the top of every section.
- Emphasise 2-4 decisive words inside the headline with a brand colour or a soft
  highlight (a rounded translucent background, or a thick underline drawn with a gradient).

Rhythm and layout:
- Generous vertical rhythm: section padding clamp(56px, 9vw, 112px) top and bottom.
- Centre content with a .container of max-width var(--maxw) and side padding of at least 20px.
- Alternate section backgrounds (--bg / --bg-alt) so the page reads as distinct blocks; never
  ten identical white bands in a row.
- Use CSS grid for card groups: repeat(auto-fit, minmax(260px, 1fr)) with a 20-28px gap.
- Cards: --surface background, 1px --line border, --radius-lg, padding 24-32px, --shadow-sm,
  and a hover state that lifts them (translateY(-3px), stronger shadow, 200ms ease).

Colour and depth:
- Pick ONE hero treatment and commit: a soft brand gradient, a radial glow behind the headline,
  or a tinted band with a subtle CSS pattern. Keep the rest of the page mostly clean.
- Use the accent colour sparingly - CTAs, key numbers, checkmarks, the highlighted headline words.
- Add depth with layered translucency and blur, not with heavy borders.

Buttons and CTAs:
- Primary CTA: gradient or solid brand background, white text, min-height 56px, padding
  18px 36px, border-radius 999px or var(--radius), font-weight 700, font-size 1.05-1.2rem.
- Every interactive element gets hover (lift + shadow), :active (scale .98) and :focus-visible
  states, all with transitions of 150-250ms.
- CTAs are full-width on mobile, auto-width from 640px up.
- Put a small reassurance line directly under each CTA (guarantee, secure payment, instant access)
  when the brief provides one.

Icons and detail:
- Draw small inline SVG icons (checkmarks, arrows, shields, clocks) with stroke="currentColor",
  stroke-width 2, 20-24px. They make lists look designed instead of typed.
- Benefit and deliverable lists use icon bullets in a circular tinted badge, never plain discs.
- Add subtle finishing touches: a thin gradient rule between major blocks, rounded corner
  consistency, and numbered step markers as filled circles.

Motion:
- Wrap every animation in @media (prefers-reduced-motion: no-preference).
- Keep it restrained: a fade-and-rise on section entry via CSS animation, and hover transitions.
  Never anything that blocks reading or shifts layout.

CONTENT RULES
- The analysis JSON, as overridden by the TARGET PRODUCT block above when one is present, is the
  only source of truth. Where the two disagree, the TARGET PRODUCT block always wins. Do not
  invent prices, guarantees, testimonials, statistics or deadlines that appear in neither.
- Skip any section whose source data is empty rather than padding it with filler.
- Keep the promise, audience, pains, desires, mechanism and offer intent of the analysis so this
  asset stays consistent with the other asset generated from the same brief.
- Write real, persuasive prose expanded from the brief - never a bulleted restatement of the JSON.

OUTPUT RULE
- Respond with the raw HTML document ONLY. No markdown fences, no explanation before or after.`;

/* ==================================================================== */
/* Target product adaptation                                            */
/*                                                                      */
/* The analysed VSL is frequently NOT the product being sold. This block */
/* is prepended to both generators - identically - so the sales page and */
/* the quiz are adapted the same way and stay consistent with each other.*/
/* ==================================================================== */

const LANGUAGE_NAMES: Record<string, string> = {
  "pt-BR": "Brazilian Portuguese",
  "pt-PT": "European Portuguese",
  pt: "Portuguese",
  en: "English",
  "en-US": "American English",
  "en-GB": "British English",
  es: "Spanish",
  "es-MX": "Mexican Spanish",
  "es-ES": "European Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

export function languageName(code: string): string {
  if (!code) return "";
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES[code.split("-")[0]] ?? code;
}

/**
 * @param settings the operator's target product overrides
 * @param source   the ORIGINAL analysis, used to name what must NOT be sold
 */
export function buildAdaptationBrief(
  settings: GenerationSettings,
  source: VslAnalysis,
): string {
  if (!hasSettings(settings)) return "";

  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value) lines.push(`- ${label}: ${value}`);
  };

  add("Product name", settings.product_name);
  add("Product type", settings.product_type);
  add("Market / country", settings.country);
  add(
    "Output language",
    settings.language ? `${languageName(settings.language)} (lang="${settings.language}")` : "",
  );
  add("Price (render EXACTLY as written)", settings.price);
  add("Payment options", settings.payment_note);
  add("Guarantee", settings.guarantee);
  add("Primary CTA label", settings.cta_label);
  add("CTA link (href)", settings.cta_url);
  add("Audience", settings.audience_note);

  const sourceIdentity = [
    source.offer_name && `"${source.offer_name}"`,
    source.product_type && `a ${source.product_type}`,
    source.offer.price && `priced at ${source.offer.price}`,
    source.language && `written in ${languageName(source.language)}`,
  ].filter(Boolean).join(", ");

  const custom = settings.custom_instructions
    ? `

OPERATOR INSTRUCTIONS - these have the HIGHEST priority and override anything
above or in the analysis that contradicts them:
${settings.custom_instructions}`
    : "";

  return `=== TARGET PRODUCT - READ THIS BEFORE THE ANALYSIS ===

The analysis further down was extracted from a source VSL selling ${
    sourceIdentity || "a different product"
  }.
You are NOT selling that product. You are writing for this product instead:

${lines.join("\n")}

How to use the analysis:
- KEEP the persuasion architecture: the pain points, desires, emotional beats,
  awareness level, unique-mechanism framing, objection handling and page
  structure are what make the source VSL convert. Reuse all of it.
- REPLACE every product-specific detail with the target product above: name,
  category, price, currency, payment terms, guarantee, delivery format and CTA.
- NEVER mention the source product, its name, its price, its currency, or any
  claim that only applies to it. A reader must not be able to tell that the
  copy started life as a different offer.
- Do not carry over claims that no longer fit the product category. If the
  source sells a supplement and the target is an information product, drop
  every reference to capsules, dosage, ingredients, absorption or clinical
  trials, and reframe the same benefit as knowledge, method, recipes or steps
  the reader applies themselves.
- Keep every promise honest for the NEW product: an e-book teaches and guides,
  it does not treat, cure or medicate. Never imply medical outcomes for an
  information product.
- Write ALL copy natively in the output language - idiomatic, culturally
  native writing for the target market, never a literal translation. Use that
  market's conventions for currency, dates, numbers and formality.
- Match the price point's register: a low-ticket offer should feel accessible
  and immediate, not like a high-ticket program with a long qualification
  sequence.${custom}

=== END TARGET PRODUCT ===

`;
}

/* ==================================================================== */
/* Visual style presets                                                 */
/*                                                                      */
/* The analysis picks a palette from the niche, and it is often drab.   */
/* A preset overrides that with a deliberate, opinionated art direction */
/* - the single biggest lever on how designed the output looks. Applied */
/* identically to both assets.                                          */
/* ==================================================================== */

const STYLE_PRESETS: Record<string, string> = {
  modern: `VISUAL STYLE: MODERN SAAS
- Palette: near-white canvas (#ffffff / #f8fafc), deep slate ink (#0f172a), one confident accent.
  Keep it cool and restrained; colour appears only on CTAs, icons and key numbers.
- Typography: tight, geometric, heavy headings (font-weight 800, letter-spacing -0.03em).
  Body in #475569 at 1.0625rem/1.7.
- Surfaces: white cards on a #f8fafc band, 1px #e2e8f0 borders, radius 16px, very soft shadows.
- Texture: a faint dot or grid pattern behind the hero only, masked to fade out.
- Feel: precise, calm, credible. Lots of whitespace. Nothing shouts.`,

  bold: `VISUAL STYLE: BOLD DIRECT RESPONSE
- Palette: high contrast. Near-black ink (#0b0f19), white surfaces, one saturated accent used
  aggressively (buttons, highlight marks, numbers), plus a warning colour for scarcity.
- Typography: oversized headings - h1 clamp(2.4rem, 6.5vw, 4.5rem), weight 900, tight leading.
  Highlight 2-4 words with a thick marker-style background sweep in the accent.
- Surfaces: strong section contrast - alternate white and a dark band with light text.
- Devices: a bordered "offer box" with a coloured header bar, a struck-through anchor price,
  and the real price rendered very large. Scarcity as a solid alert strip.
- Feel: urgent, punchy, unmissable. This is a page that sells hard.`,

  elegant: `VISUAL STYLE: ELEGANT EDITORIAL
- Palette: warm off-white paper (#faf8f5), rich near-black text (#1c1917), a muted jewel accent
  (deep teal, burgundy or forest). Gold-ish hairlines. No pure black, no pure white.
- Typography: Georgia, "Times New Roman", serif for headings at generous sizes with wide
  leading; sans-serif for body and UI. Small-caps eyebrow labels with wide letter-spacing.
- Surfaces: almost no cards - use hairline rules, generous margins and a narrow 640px reading
  column. Radius 6px maximum. Shadows are barely visible.
- Feel: premium, considered, magazine-like. Restraint everywhere.`,

  warm: `VISUAL STYLE: WARM WELLNESS
- Palette: soft cream (#fdfaf6), warm sand and clay tones, a calm green or terracotta accent,
  gentle brown-grey text (#4a4139). Nothing harsh or corporate.
- Typography: rounded, friendly, medium weights. Comfortable 1.75 line-height.
- Surfaces: large border radii (20-28px), soft blurred shadows, organic blob shapes drawn in
  CSS behind sections, gentle vertical gradients between bands.
- Feel: reassuring, human, unhurried. Suits health, food, self-care and coaching offers.`,

  vibrant: `VISUAL STYLE: VIBRANT GRADIENT
- Palette: a bright multi-stop gradient identity (two or three hues), near-white base, deep
  ink text. Gradients on the hero, the CTA buttons and small accents only.
- Typography: heavy, modern, tight. Gradient-filled text for 2-3 headline words using
  background-clip: text.
- Surfaces: glassy cards - translucent white, 1px light border, backdrop-filter: blur(12px),
  sitting over soft coloured blobs blurred at 80-120px.
- Feel: energetic, contemporary, product-launch. Keep contrast legal: text never sits directly
  on a busy gradient without a solid backing.`,

  dark: `VISUAL STYLE: DARK PREMIUM
- Palette: deep near-black background (#0a0a0f) with layered dark surfaces (#14141c), light
  text (#e8e8f0), and one luminous accent used as a glow.
- Typography: bright white headings, body at ~70% opacity. Tight tracking on large sizes.
- Surfaces: subtle 1px light borders (rgba(255,255,255,.08)), radial accent glows behind the
  hero and the offer box, and cards that brighten on hover.
- Contrast: every text/background pair must still clear 4.5:1 - do not let body text fade out.
- Feel: high-end, technological, confident.`,
};

export const STYLE_PRESET_IDS = Object.keys(STYLE_PRESETS);

/**
 * Art direction block. Emitted for both assets so a project's sales page and
 * quiz always look like the same product.
 */
export function buildStyleDirection(settings: GenerationSettings): string {
  const preset = STYLE_PRESETS[settings.style_preset];
  const colour = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(settings.primary_color)
    ? settings.primary_color
    : "";

  if (!preset && !colour) return "";

  const parts: string[] = [];
  if (preset) parts.push(preset);
  if (colour) {
    parts.push(
      `BRAND COLOUR: use ${colour} as the primary brand colour. Derive a darker shade for
hover states and a light tint (8-12% opacity) for backgrounds from it. It overrides the
palette in the analysis brief.`,
    );
  }

  return `\n${parts.join("\n\n")}\n`;
}

/* ==================================================================== */
/* 2. Sales page                                                        */
/* ==================================================================== */

export const SALES_PAGE_SYSTEM = `You are an elite direct-response copywriter and front-end developer.
You turn a structured VSL brief into a high-converting, production-ready long-form sales page
written as a single HTML file. Your pages look like they were designed by a professional studio:
confident typography, generous spacing, clear visual hierarchy and a rhythm that pulls the reader
toward the call to action.`;

export function buildSalesPagePrompt(
  analysis: VslAnalysis,
  adaptation = "",
  style = "",
): string {
  return `${adaptation}Build the sales page for the offer described in this brief.

Required sections, in this order (omit a section only when its data is empty):
1.  <header> with the headline (h1), the subheadline, and a primary CTA button.
2.  "The problem" - the pain points, as an empathetic section that makes the reader feel understood.
3.  "What you really want" - the desires, framed as the achievable future state.
4.  The unique mechanism - name it, explain it, and say why it works where other methods fail.
5.  The solution - what it is and how it works, using the solution steps as a numbered flow.
6.  Benefits - a responsive card grid.
7.  Proof - testimonials, credentials and stats. Omit entirely if the brief has none.
8.  The offer - deliverables and bonuses with their stated values, the price, payment options,
    the guarantee, and any scarcity. Present it as a boxed, visually distinct offer stack.
9.  Objection handling - the objections and their responses.
10. FAQ - an accessible accordion built with <details>/<summary>. No JavaScript required.
11. Final CTA - restate the big promise, the button, and the supporting reassurance line.
12. <footer> with a short disclaimer line and a copyright line using the offer name.

ART DIRECTION for this page:
- Hero: give it real presence. A tinted or softly gradient band, a radial brand glow behind the
  headline, an eyebrow label above the h1, the subheadline in a lighter weight at ~1.25rem, the
  CTA, and a row of 3 short trust chips underneath (guarantee, format, access) built only from
  facts in the brief. Keep the hero centred and no wider than ~840px.
- Pain section: cards or a two-column list with a small icon per item; a slightly darker or
  tinted background so it feels like the "before" state.
- Desires: visually lighter than the pain section - this is the "after". Consider a soft brand
  tint and check-circle icons.
- Mechanism: the visual centrepiece. Name it in a badge, then a wide feature block with the
  explanation and a "why it works" callout in a bordered, tinted box.
- Solution steps: a numbered flow with filled circular markers connected by a thin line on
  desktop, stacking cleanly on mobile.
- Benefits: an auto-fit card grid, each card with an icon badge, a bold title and one sentence.
- Proof: testimonial cards with a quotation mark drawn in CSS, the quote in slightly larger
  italic-free text, and the author line in --muted. Stats become big numbers with small captions.
- Offer stack: the most designed block on the page. A bordered panel with a subtle brand glow,
  each deliverable and bonus as a row with an icon, its name and its value right-aligned, a
  divider, then the total value struck through above the real price rendered large (clamp up to
  3rem). Guarantee in its own bordered badge with a shield icon. Scarcity as a small alert strip.
- Objections: two-column on desktop, each pair with the objection as a heading and the response
  beneath in --body.
- FAQ: <details>/<summary> with a chevron drawn in CSS that rotates when open, hairline dividers,
  and a comfortable 18-20px vertical padding per row.
- Final CTA: full-width brand band, the promise restated as an h2, the button, the reassurance
  line, and nothing else competing with it.
- Add a sticky bottom CTA bar on mobile only (max-width: 767px) that appears after the hero
  scrolls away, using position: fixed and a safe-area-aware padding.

Copy notes:
- Repeat the primary CTA at least three times down the page, each with the analysis CTA label
  and href set to the analysis cta.url value.
- Write real, persuasive body copy expanded from the brief - not a bulleted restatement of the JSON.
- Match the tone described in the brief.

${SHARED_BUILD_RULES}
${style}
=== ANALYSIS BRIEF (JSON) ===
${analysisBrief(analysis)}`;
}

/* ==================================================================== */
/* 3. Quiz                                                              */
/* ==================================================================== */

export const QUIZ_SYSTEM = `You are an elite conversion strategist and front-end developer who builds
interactive lead-generation quizzes. You write clean, dependency-free vanilla JavaScript and
polished CSS in a single HTML file. Your quizzes feel effortless: one question per screen, obvious
progress, and a result that lands as a personal insight rather than a sales pitch.`;

export function buildQuizPrompt(
  analysis: VslAnalysis,
  adaptation = "",
  style = "",
): string {
  return `${adaptation}Build the interactive quiz for the offer described in this brief.

Structure:
1.  Intro screen: the quiz title (h1), the subtitle, the promise line, and a "Start" button.
2.  6 to 8 questions, one visible at a time, each with 3 to 4 multiple-choice answers.
    - Questions must be derived from the brief's pain_points, desires, awareness_level and
      objections, so the quiz qualifies the same audience the sales page speaks to.
    - Every answer option carries a weight toward one of the outcome profiles in quiz_blueprint.outcomes.
3.  Navigation: a "Back" button, a "Next" button that stays disabled until an option is chosen,
    a question counter ("Question 3 of 7") and an animated progress bar.
4.  Result screen: score the answers, pick the highest-weighted outcome profile, and show its
    name, description and recommendation, plus a short personalised paragraph that ties the
    result to the big promise and the unique mechanism.
5.  Final CTA on the result screen using the brief's cta.primary_label and cta.url, with the
    supporting line beneath it, plus a "Retake quiz" link that resets state.

ART DIRECTION for this quiz:
- Centre a single card (max-width ~640px) on a soft brand-tinted or gradient page background,
  vertically centred on tall screens. The card gets --radius-lg, --shadow-lg and 32-40px padding.
- Above the card, a compact brand bar: the offer name as a small wordmark and, once started, the
  question counter on the right.
- Progress bar: 6-8px tall, fully rounded, brand gradient fill, width animated with a 350ms ease
  transition. It sits directly under the brand bar and is announced with aria-valuenow.
- Options are large tappable rows, not radio dots: min-height 60px, --radius, 1px --line border,
  a letter badge (A/B/C/D) on the left, the label in the middle. Hover lifts and tints the border;
  the selected state gets a brand border, a soft brand background tint and a check icon on the
  right. Never rely on colour alone for the selected state.
- Question transitions: fade + 8px rise on the incoming question, 200-260ms, disabled under
  prefers-reduced-motion.
- Navigation row: a quiet text "Back" button on the left, the primary "Next" button on the right,
  full-width stacked on mobile. The disabled Next button must look clearly inert.
- Result screen: an animated circular or bar visual showing how strongly the profile matched,
  the profile name as an h2, the description, the recommendation in a bordered tinted callout,
  then the CTA button, the reassurance line, and a quiet "Retake quiz" text link.
- The whole quiz must feel like one polished product, sharing the sales page's brand colours.

JavaScript rules:
- Vanilla JS in one <script> block at the end of <body>. No libraries, no modules, no fetch.
- Hold the questions and their outcome weights in a single QUESTIONS array constant, and the
  outcomes in an OUTCOMES object, so the content is easy to edit later.
- Render screens by toggling a hidden attribute or class - never rebuild the whole document.
- Keep answers in state so the Back button restores the previously selected option.
- Guard against a tie in scoring by falling back to the first outcome with the top score.
- Keyboard accessible: options are real <button> or <input type="radio"> elements inside a
  <fieldset> with a <legend>, and focus moves to the new question heading on each step.
- Must not throw on any path. No console errors.

${SHARED_BUILD_RULES}
${style}
=== ANALYSIS BRIEF (JSON) ===
${analysisBrief(analysis)}`;
}
