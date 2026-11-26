-- Inventory item photos (Запчасти → фото товара).
--
-- 1. inventory_items.photo_path: storage path of the item photo in the private "inventory-photos" bucket
--    ({workspace_id}/{item_id}/{stamp}.webp; the list thumbnail is the same path with "_t.webp"). NULL = no photo.
-- 2. inventory_items_with_status: the same columns in the same order, plus photo_path at the end
--    (CREATE OR REPLACE VIEW may only append columns).
-- 3. Private bucket "inventory-photos" (5 MB, images only) + storage policies: members of the workspace whose id
--    is the first folder of the object name can read / upload / replace / delete; everyone else is denied.
--
-- Additive only: no existing column, row, policy or bucket is changed. The app keeps working before this is
-- applied (no photos are shown, adding a photo reports that the database is not updated yet).
-- Idempotent.

begin;

alter table public.inventory_items
  add column if not exists photo_path text;

comment on column public.inventory_items.photo_path is
  'Item photo in storage bucket inventory-photos ({workspace_id}/{item_id}/{stamp}.webp; thumbnail: same path with _t.webp). NULL = no photo.';

-- Same columns as 20261119140000_inventory_search_compact, plus photo_path at the end.
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
  i.search_compact,
  i.photo_path
from public.inventory_items i;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-photos', 'inventory-photos', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "Workspace members can view inventory photos" on storage.objects;
drop policy if exists "Workspace members can upload inventory photos" on storage.objects;
drop policy if exists "Workspace members can update inventory photos" on storage.objects;
drop policy if exists "Workspace members can delete inventory photos" on storage.objects;

-- The workspace id is the first folder of the name; the CASE keeps the uuid cast away from any other shape
-- (such names are denied instead of raising 22P02).
create policy "Workspace members can view inventory photos"
  on storage.objects as permissive for select to authenticated
  using (
    bucket_id = 'inventory-photos'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace members can upload inventory photos"
  on storage.objects as permissive for insert to authenticated
  with check (
    bucket_id = 'inventory-photos'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace members can update inventory photos"
  on storage.objects as permissive for update to authenticated
  using (
    bucket_id = 'inventory-photos'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
        then split_part(name, '/', 1)::uuid
      end
    )
  )
  with check (
    bucket_id = 'inventory-photos'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace members can delete inventory photos"
  on storage.objects as permissive for delete to authenticated
  using (
    bucket_id = 'inventory-photos'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

commit;

-- PostgREST picks up the new column after a schema reload:
notify pgrst, 'reload schema';

-- Check:
-- select column_name from information_schema.columns where table_name = 'inventory_items_with_status' order by ordinal_position;
-- select id, public, file_size_limit from storage.buckets where id = 'inventory-photos';
