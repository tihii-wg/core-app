import type { OrderMaterial } from "../../lib/types";

export type WarehouseMaterialStatus = "not_issued" | "partially_issued" | "fully_issued" | "partially_returned" | "fully_returned";

export function materialIssued(line: Pick<OrderMaterial, "quantityIssued">) {
  return Number(line.quantityIssued ?? 0);
}

export function materialReturned(line: Pick<OrderMaterial, "quantityReturned">) {
  return Number(line.quantityReturned ?? 0);
}

/** Quantity still available to issue: requested − already issued. */
export function remainingToIssue(line: Pick<OrderMaterial, "quantity" | "quantityIssued">) {
  return Math.max(0, roundQty(Number(line.quantity) - materialIssued(line)));
}

/** Quantity that can still be returned: issued − already returned. */
export function remainingToReturn(line: Pick<OrderMaterial, "quantityIssued" | "quantityReturned">) {
  return Math.max(0, roundQty(materialIssued(line) - materialReturned(line)));
}

/** Net quantity retained outside the warehouse. */
export function netOutsideWarehouse(line: Pick<OrderMaterial, "quantityIssued" | "quantityReturned">) {
  return remainingToReturn(line);
}

export function warehouseMaterialStatus(line: Pick<OrderMaterial, "quantity" | "quantityIssued" | "quantityReturned">): WarehouseMaterialStatus {
  const issued = materialIssued(line);
  const returned = materialReturned(line);
  const requested = Number(line.quantity) || 0;

  if (issued <= 0) return "not_issued";
  if (returned > 0 && returned >= issued) return "fully_returned";
  if (returned > 0) return "partially_returned";
  if (issued >= requested) return "fully_issued";
  return "partially_issued";
}

export function warehouseStatusBadgeVariant(status: WarehouseMaterialStatus): "muted" | "warning" | "success" | "info" | "violet" {
  switch (status) {
    case "not_issued":
      return "muted";
    case "partially_issued":
      return "warning";
    case "fully_issued":
      return "success";
    case "partially_returned":
      return "info";
    case "fully_returned":
      return "violet";
  }
}

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}
