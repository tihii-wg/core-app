-- Parts search that ignores spaces and punctuation.
--
-- Article numbers are stored in many shapes ("0 258 986 627", "#55501-4M400", "W 712/75") and people type
-- them without separators ("0258986627", "555014M400"). A plain ILIKE on sku never matched those.
--
-- Adds inventory_items.search_compact: name + sku + category + supplier + location + description glued
-- together with all whitespace and ASCII punctuation removed (letters of any alphabet are kept; case is
-- handled by ILIKE). Stored generated column → always in sync, no triggers, no app writes.
-- Exposes it through inventory_items_with_status (appended as the last column; existing columns unchanged).
--
-- The app keeps working before this is applied (it falls back to the per-field search).
-- Idempotent.

begin;

alter table public.inventory_items
  add column if not exists search_compact text
  generated always as (
    regexp_replace(
      coalesce(name, '') || coalesce(sku, '') || coalesce(category, '') ||
      coalesce(supplier, '') || coalesce(location, '') || coalesce(description, ''),
      '[[:space:][:punct:]]+', '', 'g'
    )
  ) stored;

comment on column public.inventory_items.search_compact is
  'Search helper: all text fields without whitespace / punctuation (article numbers typed without separators).';

-- Same columns as before, in the same order, plus search_compact at the end (CREATE OR REPLACE may only append).
create or replace view public.inventory_items_with_status
  with (security_invoker = true)
as
select
  i.id,
  i.workspace_id,
  i.name,
  i.sku,
  i.description,
  i.category,
  i.quantity,
  i.min_quantity,
  i.unit,
  i.purchase_price,
  i.selling_price,
  i.supplier,
  i.location,
  i.is_active,
  i.created_at,
  i.updated_at,
  i.warranty_type,
  i.warranty_months,
  i.warranty_km,
  case
    when i.quantity <= 0::numeric then 'out_of_stock'::text
    when i.quantity <= i.min_quantity then 'low_stock'::text
    else 'in_stock'::text
  end as stock_status,
  i.search_compact
from public.inventory_items i;

commit;

-- PostgREST picks up the new column after a schema reload:
notify pgrst, 'reload schema';

-- Check:
-- select name, sku, search_compact from public.inventory_items where sku is not null limit 5;
