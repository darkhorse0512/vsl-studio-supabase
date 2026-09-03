-- =====================================================================
--  Target product settings.
--
--  The analysed VSL and the product actually being sold are often not the
--  same thing: a $200 English nutraceutical VSL can be the source material
--  for a R$37 Portuguese recipe e-book.
--
--  These settings override the analysed offer at GENERATION time. They live
--  on the project (not on the individual asset) so the sales page and the
--  quiz are always built from the same overrides - the consistency
--  guarantee holds exactly as before.
--
--  Shape (all keys optional; empty string = "keep what the VSL said"):
--    {
--      "language":            "pt-BR",
--      "country":             "Brazil",
--      "product_name":        "Receitas Que Curam",
--      "product_type":        "recipe e-book",
--      "price":               "R$ 37",
--      "payment_note":        "ou 3x de R$ 12,90",
--      "guarantee":           "7 dias de garantia incondicional",
--      "cta_label":           "Quero minhas receitas",
--      "cta_url":             "https://pay.example.com/checkout",
--      "audience_note":       "mulheres 35-60 no Brasil",
--      "custom_instructions": "free-text rules the AI must follow"
--    }
-- =====================================================================

alter table public.projects
  add column if not exists generation_settings jsonb not null default '{}'::jsonb;

comment on column public.projects.generation_settings is
  'Target product overrides applied to the analysis at generation time. Shared by every asset of the project so they stay consistent.';

-- Reject anything that is not a JSON object.
alter table public.projects
  add constraint projects_generation_settings_is_object
  check (jsonb_typeof(generation_settings) = 'object');
