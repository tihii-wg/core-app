-- =============================================================================
-- New business type: custom cabinet furniture manufacturing
-- Script: 20261108090000_industry_furniture_manufacturing.PRODUCTION.sql
-- MAIN only. Manual apply. Idempotent.
-- Adds the industry row (slug furniture_manufacturing) so it appears in sign-up / business setup.
-- The app translates known slugs (src/features/industries/industryName.ts); the English name is the fallback.
-- =============================================================================

insert into public.industries (name, slug, description, is_active)
values (
  'Custom Furniture Manufacturing',
  'furniture_manufacturing',
  'Made-to-measure cabinet furniture: kitchens, wardrobes, built-ins — measurement, design, production, delivery and installation',
  true
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      is_active = true;

-- Check: select name, slug, is_active from public.industries order by name;
