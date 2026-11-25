import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { builtinOrderFieldMeta } from "./orderFieldRegistry";

/**
 * Order-field layout: which fields move together and how a new order maps to sort_order writes.
 *
 * - Top-level fields can be placed anywhere relative to each other (forms and the card render them in this order).
 * - Vehicle sub-fields (make, model, VIN, mileage…) live inside the vehicle block: they are ordered among themselves.
 * - Status and total have a fixed place (card header / totals) and are not reordered.
 */

/** Fields whose place is fixed by the layout (header badge / totals summary). */
export const FIXED_POSITION_FIELD_KEYS: ReadonlySet<string> = new Set(["status", "total"]);

/** Built-in vehicle sub-field (rendered inside the vehicle block). */
export function isVehicleSubField(key: string): boolean {
  return key !== "vehicle" && key.startsWith("vehicle") && Boolean(builtinOrderFieldMeta(key));
}

function fallbackRank(key: string): number {
  return builtinOrderFieldMeta(key)?.defaultSortOrder ?? Number.MAX_SAFE_INTEGER;
}

/** Sort any keyed blocks by the workspace field order (unknown keys keep their given order, after known ones). */
export function sortByFieldOrder<T extends { key: string }>(
  items: readonly T[],
  fieldMap: Map<string, OrderFieldConfigItem> | undefined,
): T[] {
  const position = new Map(items.map((item, index) => [item.key, index]));
  const rank = (key: string) => fieldMap?.get(key)?.sortOrder ?? fallbackRank(key);
  return [...items].sort((a, b) => rank(a.key) - rank(b.key) || (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0));
}

export type FieldOrderTree = {
  /** Freely movable fields, in display order. */
  top: OrderFieldConfigItem[];
  /** Vehicle sub-fields, in display order (shown under the vehicle field). */
  vehicleChildren: OrderFieldConfigItem[];
  /** Fixed-position fields (status, total). */
  fixed: OrderFieldConfigItem[];
};

function bySortOrder(a: OrderFieldConfigItem, b: OrderFieldConfigItem) {
  return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
}

export function buildFieldOrderTree(fields: readonly OrderFieldConfigItem[]): FieldOrderTree {
  const sorted = [...fields].sort(bySortOrder);
  const hasVehicle = sorted.some((field) => field.key === "vehicle");
  return {
    top: sorted.filter(
      (field) => !FIXED_POSITION_FIELD_KEYS.has(field.key) && !(hasVehicle && isVehicleSubField(field.key)),
    ),
    vehicleChildren: hasVehicle ? sorted.filter((field) => isVehicleSubField(field.key)) : [],
    fixed: sorted.filter((field) => FIXED_POSITION_FIELD_KEYS.has(field.key)),
  };
}

/** Display order of every field: top fields, vehicle sub-fields right after the vehicle, fixed fields last. */
export function flattenFieldOrderTree(tree: FieldOrderTree): OrderFieldConfigItem[] {
  const flat: OrderFieldConfigItem[] = [];
  for (const field of tree.top) {
    flat.push(field);
    if (field.key === "vehicle") flat.push(...tree.vehicleChildren);
  }
  // Vehicle sub-fields without a vehicle field (should not happen) still keep a place.
  if (!tree.top.some((field) => field.key === "vehicle")) flat.push(...tree.vehicleChildren);
  flat.push(...tree.fixed);
  return flat;
}

/** Move one field within its own list (top or vehicle children) to `toIndex`. */
export function moveFieldInTree(tree: FieldOrderTree, key: string, toIndex: number): FieldOrderTree {
  const list: "top" | "vehicleChildren" | null = tree.top.some((field) => field.key === key)
    ? "top"
    : tree.vehicleChildren.some((field) => field.key === key)
      ? "vehicleChildren"
      : null;
  if (!list) return tree;
  const items = [...tree[list]];
  const from = items.findIndex((field) => field.key === key);
  const target = Math.max(0, Math.min(items.length - 1, toIndex));
  if (from < 0 || from === target) return tree;
  const [moved] = items.splice(from, 1);
  items.splice(target, 0, moved as OrderFieldConfigItem);
  return { ...tree, [list]: items };
}

export type FieldOrderWrite = { field: OrderFieldConfigItem; sortOrder: number };

function strictlyIncreasing(values: number[]) {
  for (let index = 1; index < values.length; index += 1) {
    if (!((values[index] as number) > (values[index - 1] as number))) return false;
  }
  return true;
}

/**
 * sort_order writes that make `nextFlat` the stored order.
 * A single moved field gets one write (a value between its new neighbours) when there is room;
 * otherwise everything is renumbered 10, 20, 30… and only changed rows are written.
 */
export function planFieldOrderWrites(nextFlat: readonly OrderFieldConfigItem[], movedKey: string | null): FieldOrderWrite[] {
  if (movedKey) {
    const index = nextFlat.findIndex((field) => field.key === movedKey);
    if (index >= 0) {
      const prev = nextFlat[index - 1]?.sortOrder;
      const next = nextFlat[index + 1]?.sortOrder;
      let candidate: number | null = null;
      if (prev == null && next != null) candidate = next - 10;
      else if (next == null && prev != null) candidate = prev + 10;
      else if (prev != null && next != null && next - prev >= 2) candidate = Math.floor((prev + next) / 2);
      if (candidate != null) {
        const values = nextFlat.map((field, position) => (position === index ? (candidate as number) : field.sortOrder));
        if (strictlyIncreasing(values)) {
          const field = nextFlat[index] as OrderFieldConfigItem;
          return field.sortOrder === candidate ? [] : [{ field, sortOrder: candidate }];
        }
      }
    }
  }
  return nextFlat
    .map((field, position) => ({ field, sortOrder: (position + 1) * 10 }))
    .filter((write) => write.field.sortOrder !== write.sortOrder);
}
