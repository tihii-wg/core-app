import type { Order, OrderMaterial } from "../../../lib/types";

/** Same keys and same values (one level deep) — line objects are rebuilt on every server response. */
export function shallowEqualObject(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a) as (keyof typeof a)[];
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (!Object.is(a[key], (b as typeof a)[key])) return false;
  }
  return true;
}

/** Only the order fields a line row actually reads (warranty badge). */
function orderRowFieldsEqual(a: Order, b: Order): boolean {
  return (
    a === b ||
    (a.closedAt === b.closedAt && a.status === b.status && a.vehicleMileageUnitSnapshot === b.vehicleMileageUnitSnapshot)
  );
}

/** Lines of the same catalog item + warehouse — the only siblings that change a row's stock limit. */
function sameItemSiblingsEqual(line: OrderMaterial, a: Order, b: Order): boolean {
  if (a.materials === b.materials) return true;
  const pick = (order: Order) =>
    (order.materials ?? []).filter(
      (entry) => entry.inventoryItemId === line.inventoryItemId && entry.warehouseId === line.warehouseId,
    );
  const left = pick(a);
  const right = pick(b);
  return left.length === right.length && left.every((entry, index) => shallowEqualObject(entry, right[index]));
}

type RowLikeProps = {
  line: object;
  order: Order;
  saving: boolean;
  [key: string]: unknown;
};

function compareRowProps(prev: RowLikeProps, next: RowLikeProps, editing: (p: RowLikeProps) => boolean) {
  for (const key of Object.keys(next)) {
    if (key === "line" || key === "order" || key === "saving") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  if (!shallowEqualObject(prev.line, next.line)) return false;
  if (!orderRowFieldsEqual(prev.order, next.order)) return false;
  // The saving flag only affects the row whose editor is open.
  const prevSaving = prev.saving && editing(prev);
  const nextSaving = next.saving && editing(next);
  return prevSaving === nextSaving;
}

/** React.memo comparator for service rows: a price edit re-renders only the edited row. */
export function serviceRowPropsEqual<P extends RowLikeProps>(prev: P, next: P): boolean {
  return compareRowProps(prev, next, (p) => Boolean(p.isEditingPrice || p.isEditingQty || p.isEditingPerformer));
}

/** React.memo comparator for material rows (also watches same-item siblings for the stock cap). */
export function materialRowPropsEqual<P extends RowLikeProps & { line: OrderMaterial }>(prev: P, next: P): boolean {
  return (
    compareRowProps(prev, next, (p) => Boolean(p.isEditingPrice || p.isEditingQty)) &&
    sameItemSiblingsEqual(next.line, prev.order, next.order)
  );
}
