/**
 * Warranty calculations and pure helpers.
 * Snapshots (DB) are authoritative after close; these helpers evaluate status from snapshots + current mileage.
 */

export type WarrantyItemKind = "service" | "material";

export type WarrantyLimits = {
  /** Calendar months of coverage. Null/0 = no duration limit. */
  durationMonths: number | null;
  /** Mileage allowance from start mileage. Null/0 = no mileage limit. */
  mileageLimit: number | null;
};

export type WarrantySnapshot = WarrantyLimits & {
  id: string;
  orderId: string;
  itemKind: WarrantyItemKind;
  itemName: string;
  orderServiceId: string | null;
  orderMaterialId: string | null;
  startsAt: string;
  endsOn: string | null;
  startMileage: number | null;
  expiresAtMileage: number | null;
};

export type WarrantyStatusCode =
  | "none"
  | "pending"
  | "active"
  | "expired_date"
  | "expired_mileage"
  | "unavailable";

export type WarrantyEvaluation = {
  status: WarrantyStatusCode;
  expiresOn: string | null;
  expiresAtMileage: number | null;
  remainingMileage: number | null;
  reason: string | null;
};

export function normalizeWarrantyMonths(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function normalizeWarrantyKm(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function hasWarrantyCoverage(limits: WarrantyLimits): boolean {
  return Boolean(normalizeWarrantyMonths(limits.durationMonths) || normalizeWarrantyKm(limits.mileageLimit));
}

/** Add calendar months in a timezone-aware way using UTC date parts of the start instant. */
export function addCalendarMonthsIso(startIso: string, months: number): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || months <= 0) return startIso;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const hours = start.getUTCHours();
  const minutes = start.getUTCMinutes();
  const seconds = start.getUTCSeconds();
  const ms = start.getUTCMilliseconds();
  const targetMonth = month + months;
  const end = new Date(Date.UTC(year, targetMonth, 1, hours, minutes, seconds, ms));
  const daysInTarget = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, daysInTarget));
  return end.toISOString();
}

export function toDateOnlyUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function buildWarrantyExpiration(params: {
  startsAt: string;
  durationMonths: number | null;
  startMileage: number | null;
  mileageLimit: number | null;
}): { endsOn: string | null; expiresAtMileage: number | null } {
  const months = normalizeWarrantyMonths(params.durationMonths);
  const limit = normalizeWarrantyKm(params.mileageLimit);
  const endsOn = months ? toDateOnlyUtc(addCalendarMonthsIso(params.startsAt, months)) : null;
  const startMileage =
    params.startMileage != null && Number.isFinite(Number(params.startMileage)) ? Math.max(0, Math.floor(Number(params.startMileage))) : null;
  const expiresAtMileage = limit != null && startMileage != null ? startMileage + limit : null;
  return { endsOn, expiresAtMileage };
}

/**
 * Evaluate a stored warranty snapshot against "now" and current vehicle mileage.
 * When both date and mileage limits exist, the first one reached expires the warranty.
 */
export function evaluateWarranty(params: {
  snapshot: Pick<WarrantySnapshot, "startsAt" | "endsOn" | "startMileage" | "expiresAtMileage" | "durationMonths" | "mileageLimit">;
  nowIso?: string;
  currentMileage?: number | null;
}): WarrantyEvaluation {
  const { snapshot } = params;
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const startsAt = new Date(snapshot.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return { status: "unavailable", expiresOn: snapshot.endsOn, expiresAtMileage: snapshot.expiresAtMileage, remainingMileage: null, reason: "invalid_start" };
  }
  if (!hasWarrantyCoverage(snapshot)) {
    return { status: "none", expiresOn: null, expiresAtMileage: null, remainingMileage: null, reason: null };
  }
  if (now.getTime() < startsAt.getTime()) {
    return {
      status: "pending",
      expiresOn: snapshot.endsOn,
      expiresAtMileage: snapshot.expiresAtMileage,
      remainingMileage: remainingMileage(snapshot.expiresAtMileage, params.currentMileage),
      reason: null,
    };
  }

  const endsOn = snapshot.endsOn;
  if (endsOn) {
    const end = new Date(`${endsOn}T23:59:59.999Z`);
    if (!Number.isNaN(end.getTime()) && now.getTime() > end.getTime()) {
      return {
        status: "expired_date",
        expiresOn: endsOn,
        expiresAtMileage: snapshot.expiresAtMileage,
        remainingMileage: remainingMileage(snapshot.expiresAtMileage, params.currentMileage),
        reason: "expired_date",
      };
    }
  }

  const expiresAtMileage = snapshot.expiresAtMileage;
  if (expiresAtMileage != null && params.currentMileage != null && Number.isFinite(params.currentMileage)) {
    if (Math.floor(params.currentMileage) >= expiresAtMileage) {
      return {
        status: "expired_mileage",
        expiresOn: endsOn,
        expiresAtMileage,
        remainingMileage: 0,
        reason: "expired_mileage",
      };
    }
  }

  return {
    status: "active",
    expiresOn: endsOn,
    expiresAtMileage,
    remainingMileage: remainingMileage(expiresAtMileage, params.currentMileage),
    reason: null,
  };
}

function remainingMileage(expiresAtMileage: number | null | undefined, currentMileage: number | null | undefined): number | null {
  if (expiresAtMileage == null || currentMileage == null || !Number.isFinite(currentMileage)) return null;
  return Math.max(0, expiresAtMileage - Math.floor(currentMileage));
}

export function isWarrantyExpired(status: WarrantyStatusCode): boolean {
  return status === "expired_date" || status === "expired_mileage";
}

/** Defaults applied when appending a new line (null = disabled / no coverage). */
export type WorkspaceWarrantyDefaults = {
  serviceDurationMonths: number | null;
  serviceMileageLimit: number | null;
  partsDurationMonths: number | null;
  partsMileageLimit: number | null;
};

export function defaultsForKind(defaults: WorkspaceWarrantyDefaults, kind: WarrantyItemKind): WarrantyLimits {
  if (kind === "service") {
    return { durationMonths: defaults.serviceDurationMonths, mileageLimit: defaults.serviceMileageLimit };
  }
  return { durationMonths: defaults.partsDurationMonths, mileageLimit: defaults.partsMileageLimit };
}
