-- Default minimum stock for new inventory_items rows.
-- Does not rewrite existing min_quantity values.
alter table public.inventory_items
  alter column min_quantity set default 10;
