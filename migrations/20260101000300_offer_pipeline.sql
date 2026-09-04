-- =====================================================================
--  Offer pipeline
--
--  A generated asset is only as good as the offer behind it. Writing the
--  page straight from the analysis produces generic copy, so an editable
--  OFFER now sits between the two:
--
--      source (VSL / infoproduct / nutraceutical)
--            -> analysis        (extraction, unchanged)
--            -> offer           (the copy actually being sold - EDITABLE)
--            -> sales page | quiz | product PDF | ad creative
--
--  Every downstream generator reads the same offer, so consistency across
--  the four assets is structural, exactly as it was for the two.
-- =====================================================================

-- Where the project came from. Each kind carries different transformation
-- instructions (a nutraceutical VSL becomes an app + recipes, for example).
create type public.source_kind as enum ('vsl', 'infoproduct', 'nutraceutical');

alter table public.projects
  add column if not exists source_kind public.source_kind not null default 'vsl';

alter table public.projects
  add column if not exists offer jsonb,
  add column if not exists offer_model text,
  add column if not exists offer_generated_at timestamptz;

comment on column public.projects.offer is
  'The editable offer document. Written by generate-offer, edited by the owner, and consumed by every asset generator.';

create index if not exists projects_source_kind_idx on public.projects (source_kind);

-- New deliverables. ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction that creates it, which is why these live in their own
-- migration file rather than alongside the enum definition.
alter type public.asset_type add value if not exists 'product';
alter type public.asset_type add value if not exists 'ad_creative';
