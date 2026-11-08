import type { MileageUnit, OrderService, Service } from "../../lib/types";
import {
  catalogWarrantyFromDbRow,
  resolveOrderLineWarrantyForKind,
  type CatalogWarrantyDefaults,
} from "../orders/catalogWarranty";
import type { WorkspaceWarrantyDefaults } from "../orders/warranty";

/**
 * Copies the current catalog name, price, and warranty defaults into a new order line snapshot.
 * Later catalog edits must not rewrite this line — order_services stores its own price/warranty.
 * Catalog warranty_km is in km; pass `orderUnit` to convert into the order's mileage unit.
 */
export function catalogServiceToOrderLine(
  service: Pick<Service, "id" | "service_name" | "service_price"> &
    Partial<Pick<Service, "warrantyType" | "warrantyMonths" | "warrantyKm" | "defaultTechnicianId">> & {
      warranty_type?: unknown;
      warranty_months?: unknown;
      warranty_km?: unknown;
      warranty_days?: unknown;
      warranty_unit?: unknown;
    },
  workspaceDefaults?: WorkspaceWarrantyDefaults | null,
  orderUnit: MileageUnit = "km",
): OrderService {
  const catalog = catalogWarrantyFromService(service);
  const warranty = resolveOrderLineWarrantyForKind(catalog, workspaceDefaults ?? null, "service", orderUnit);
  const defaultTechnicianId =
    typeof service.defaultTechnicianId === "string" && service.defaultTechnicianId.trim()
      ? service.defaultTechnicianId.trim()
      : null;

  return {
    serviceId: service.id,
    serviceName: service.service_name,
    price: service.service_price ?? 0,
    quantity: 1,
    warrantyMonths: warranty.warrantyMonths,
    warrantyDays: warranty.warrantyDays,
    warrantyKm: warranty.warrantyKm,
    ...(defaultTechnicianId ? { technicianId: defaultTechnicianId } : {}),
  };
}

export function catalogWarrantyFromService(
  service: Partial<Pick<Service, "warrantyType" | "warrantyMonths" | "warrantyKm">> & {
    warranty_type?: unknown;
    warranty_months?: unknown;
    warranty_km?: unknown;
    warranty_days?: unknown;
    warranty_unit?: unknown;
  },
): CatalogWarrantyDefaults {
  if (service.warrantyType !== undefined || service.warrantyMonths !== undefined || service.warrantyKm !== undefined) {
    return catalogWarrantyFromDbRow({
      warranty_type: service.warrantyType,
      warranty_months: service.warrantyMonths,
      warranty_km: service.warrantyKm,
      warranty_days: service.warranty_days,
      warranty_unit: service.warranty_unit,
    });
  }
  return catalogWarrantyFromDbRow({
    warranty_type: service.warranty_type,
    warranty_months: service.warranty_months,
    warranty_km: service.warranty_km,
    warranty_days: service.warranty_days,
    warranty_unit: service.warranty_unit,
  });
}

export function orderLineAmount(line: Pick<OrderService, "price" | "quantity">): number {
  const price = Number(line.price) || 0;
  const quantity = Number(line.quantity) || 0;
  // Same as DB / orderTotals.lineGross: round(price * quantity, 2).
  return Math.round(price * quantity * 100) / 100;
}

export function sumOrderServiceLines(lines: Array<Pick<OrderService, "price" | "quantity">> | undefined): number {
  return (lines ?? []).reduce((total, line) => total + orderLineAmount(line), 0);
}
