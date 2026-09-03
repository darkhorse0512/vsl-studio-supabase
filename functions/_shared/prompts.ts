/**
 * Prompt library.
 *
 * One analysis -> two assets. The sales page and the quiz are both built
 * from the SAME VslAnalysis JSON, and both prompts are explicitly told to
 * treat that JSON as the only source of truth. That is what keeps the
 * promise, audience, pains, desires, mechanism and offer consistent.
 */
import { analysisBrief, type VslAnalysis } from "./analysis.ts";

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

const SHARED_BUILD_RULES = `Technical rules:
- Output ONE complete, self-contained HTML5 document starting with <!DOCTYPE html>.
- All CSS goes in a single <style> block in <head>. No external stylesheets, no CDNs,
  no web fonts, no frameworks, no images from the internet, no build step.
- Use a system font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif.
- Fully responsive, mobile-first. Use CSS custom properties, flexbox and grid. Include at least
  one media query for >=768px. Nothing may overflow horizontally on a 360px screen.
- Accessible: semantic landmarks (header/main/section/footer), one <h1>, logical heading order,
  aria-labels where needed, visible :focus-visible styles, and text contrast of at least 4.5:1.
- Set <html lang="..."> to the analysis "language" value and write ALL copy in that language.
- Use the analysis "brand" colours as CSS custom properties on :root.
- Decorative visuals must be pure CSS or inline SVG. Never reference an external image file.
- Never output lorem ipsum, TODOs, placeholder brackets or commentary.

Content rules:
- The analysis JSON is the ONLY source of truth. Do not invent prices, guarantees, testimonials,
  statistics or deadlines that are not in it.
- Skip any section whose source data is empty rather than padding it with filler.
- Keep the exact promise, audience, pains, desires, mechanism and offer wording intent of the
  analysis so this asset stays consistent with the other asset generated from the same brief.

Output rule:
- Respond with the raw HTML document ONLY. No markdown fences, no explanation before or after.`;

/* ==================================================================== */
/* 2. Sales page                                                        */
/* ==================================================================== */

export const SALES_PAGE_SYSTEM = `You are an elite direct-response copywriter and front-end developer.
You turn a structured VSL brief into a high-converting, production-ready long-form sales page
written as a single HTML file. Your pages look like they were designed by a professional studio:
confident typography, generous spacing, clear visual hierarchy and a rhythm that pulls the reader
toward the call to action.`;

export function buildSalesPagePrompt(analysis: VslAnalysis): string {
  return `Build the sales page for the offer described in this brief.

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

Craft notes:
- Repeat the primary CTA at least three times down the page, each with the analysis CTA label
  and href set to the analysis cta.url value.
- Write real, persuasive body copy expanded from the brief - not a bulleted restatement of the JSON.
- Match the tone described in the brief.

${SHARED_BUILD_RULES}

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

export function buildQuizPrompt(analysis: VslAnalysis): string {
  return `Build the interactive quiz for the offer described in this brief.

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

=== ANALYSIS BRIEF (JSON) ===
${analysisBrief(analysis)}`;
}
