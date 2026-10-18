/**
 * Default minimum stock for newly created inventory items.
 * Matches the database column default on public.inventory_items.min_quantity.
 * Existing rows are never rewritten when this value changes.
 */
export const DEFAULT_INVENTORY_MIN_QUANTITY = 10;
