/**
 * Catalog default warranty helpers.
 * Catalog stores defaults in km; order lines snapshot them in the order's mileage unit.
 * Activation stays on order close.
 */

import type { MileageUnit } from "../../lib/types";
import { convertMileage } from "../vehicles/vehicleMileage";
import {
  normalizeWarrantyDays,
  normalizeWarrantyKm,
  normalizeWarrantyMonths,
  type WarrantyLimits,
  type WorkspaceWarrantyDefaults,
  defaultsForKind,
  type WarrantyItemKind,
} from "./warranty";

export type CatalogWarrantyType = "none" | "duration" | "mileage" | "both";

export type CatalogWarrantyDefaults = {
  /** null = never configured → inherit workspace defaults when adding to an order. */
  warrantyType: CatalogWarrantyType | null;
  warrantyMonths: number | null;
  warrantyKm: number | null;
};

export type OrderLineWarrantySnapshot = {
  warrantyMonths: number | null;
  warrantyDays: number | null;
  warrantyKm: number | null;
};

const CATALOG_TYPES = new Set<CatalogWarrantyType>(["none", "duration", "mileage", "both"]);

export function normalizeCatalogWarrantyType(value: unknown): CatalogWarrantyType | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  return CATALOG_TYPES.has(raw as CatalogWarrantyType) ? (raw as CatalogWarrantyType) : null;
}

/** Derive a coherent type from months/km when type is missing (legacy / partial rows). */
export function inferCatalogWarrantyType(months: number | null, km: number | null): CatalogWarrantyType | null {
  const m = normalizeWarrantyMonths(months);
  const k = normalizeWarrantyKm(km);
  if (m != null && k != null) return "both";
  if (m != null) return "duration";
  if (k != null) return "mileage";
  return null;
}

/**
 * Normalize catalog warranty into a valid shape.
 * Empty/disabled values become null (never 0).
 * Invalid combinations throw.
 */
export function normalizeCatalogWarrantyDefaults(input: {
  warrantyType?: unknown;
  warrantyMonths?: unknown;
  warrantyKm?: unknown;
}): CatalogWarrantyDefaults {
  let type = normalizeCatalogWarrantyType(input.warrantyType);
  let months = normalizeWarrantyMonths(input.warrantyMonths);
  let km = normalizeWarrantyKm(input.warrantyKm);

  if (type == null) {
    type = inferCatalogWarrantyType(months, km);
  }

  if (type == null) {
    return { warrantyType: null, warrantyMonths: null, warrantyKm: null };
  }

  if (type === "none") {
    return { warrantyType: "none", warrantyMonths: null, warrantyKm: null };
  }

  if (type === "duration") {
    if (months == null) throw new Error("catalog_warranty:duration_months_required");
    return { warrantyType: "duration", warrantyMonths: months, warrantyKm: null };
  }

  if (type === "mileage") {
    if (km == null) throw new Error("catalog_warranty:mileage_required");
    return { warrantyType: "mileage", warrantyMonths: null, warrantyKm: km };
  }

  // both
  if (months == null || km == null) throw new Error("catalog_warranty:both_required");
  return { warrantyType: "both", warrantyMonths: months, warrantyKm: km };
}

/** DB write payload: null type + null limits for unconfigured; never writes 0. */
export function catalogWarrantyToDbPayload(defaults: CatalogWarrantyDefaults): {
  warranty_type: CatalogWarrantyType | null;
  warranty_months: number | null;
  warranty_km: number | null;
} {
  const normalized = normalizeCatalogWarrantyDefaults(defaults);
  return {
    warranty_type: normalized.warrantyType,
    warranty_months: normalized.warrantyMonths,
    warranty_km: normalized.warrantyKm,
  };
}

export function catalogWarrantyFromDbRow(row: {
  warranty_type?: unknown;
  warranty_months?: unknown;
  warranty_km?: unknown;
  /** Legacy services/inventory days column — months when unit is months. */
  warranty_days?: unknown;
  warranty_unit?: unknown;
}): CatalogWarrantyDefaults {
  const type = normalizeCatalogWarrantyType(row.warranty_type);
  let months = normalizeWarrantyMonths(row.warranty_months);
  const km = normalizeWarrantyKm(row.warranty_km);

  // Legacy: services stored duration in warranty_days + warranty_unit='months'
  if (months == null && row.warranty_unit === "months") {
    months = normalizeWarrantyMonths(row.warranty_days);
  }

  try {
    return normalizeCatalogWarrantyDefaults({ warrantyType: type, warrantyMonths: months, warrantyKm: km });
  } catch {
    return { warrantyType: null, warrantyMonths: null, warrantyKm: null };
  }
}

/** Catalog/workspace warranty_km is always kilometers; convert into the order's unit for the line. */
export function catalogWarrantyKmToOrderUnit(
  km: number | null | undefined,
  orderUnit: MileageUnit = "km",
): number | null {
  const normalized = normalizeWarrantyKm(km);
  if (normalized == null) return null;
  if (orderUnit === "km") return normalized;
  return convertMileage(normalized, "km", orderUnit);
}

/** Convert an order-line warranty_km between order mileage units (form vehicle switch). */
export function convertOrderLineWarrantyKm(
  km: number | null | undefined,
  fromUnit: MileageUnit,
  toUnit: MileageUnit,
): number | null {
  const normalized = normalizeWarrantyKm(km);
  if (normalized == null) return null;
  if (fromUnit === toUnit) return normalized;
  return convertMileage(normalized, fromUnit, toUnit);
}

/**
 * Snapshot for a new order line.
 * - Catalog type set → use catalog (including explicit none → all null).
 * - Catalog unconfigured (type null) → workspace defaults for that kind.
 * Mileage limits from catalog/workspace stay in km until converted with `orderUnit`.
 */
export function resolveOrderLineWarrantySnapshot(
  catalog: CatalogWarrantyDefaults | null | undefined,
  workspaceFallback: WarrantyLimits | null | undefined,
  orderUnit: MileageUnit = "km",
): OrderLineWarrantySnapshot {
  const type = catalog?.warrantyType ?? null;

  if (type != null) {
    try {
      const normalized = normalizeCatalogWarrantyDefaults(catalog ?? { warrantyType: type });
      return {
        warrantyMonths: normalized.warrantyMonths,
        warrantyDays: null,
        warrantyKm: catalogWarrantyKmToOrderUnit(normalized.warrantyKm, orderUnit),
      };
    } catch {
      return { warrantyMonths: null, warrantyDays: null, warrantyKm: null };
    }
  }

  return {
    warrantyMonths: normalizeWarrantyMonths(workspaceFallback?.durationMonths) ?? null,
    warrantyDays: normalizeWarrantyDays(workspaceFallback?.durationDays) ?? null,
    warrantyKm: catalogWarrantyKmToOrderUnit(workspaceFallback?.mileageLimit, orderUnit),
  };
}

export function resolveOrderLineWarrantyForKind(
  catalog: CatalogWarrantyDefaults | null | undefined,
  workspaceDefaults: WorkspaceWarrantyDefaults | null | undefined,
  kind: WarrantyItemKind,
  orderUnit: MileageUnit = "km",
): OrderLineWarrantySnapshot {
  const fallback = workspaceDefaults ? defaultsForKind(workspaceDefaults, kind) : null;
  return resolveOrderLineWarrantySnapshot(catalog, fallback, orderUnit);
}

/** Form default when creating a new catalog card (explicit no warranty). */
export function emptyCatalogWarrantyFormValues(): CatalogWarrantyDefaults {
  return { warrantyType: "none", warrantyMonths: null, warrantyKm: null };
}

/** Whether duration months field should be shown. */
export function catalogWarrantyShowsMonths(type: CatalogWarrantyType | null): boolean {
  return type === "duration" || type === "both";
}

/** Whether mileage field should be shown. */
export function catalogWarrantyShowsKm(type: CatalogWarrantyType | null): boolean {
  return type === "mileage" || type === "both";
}
