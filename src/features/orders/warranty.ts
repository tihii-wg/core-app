/**
 * Warranty calculations and pure helpers.
 * Snapshots (DB) are authoritative after close; these helpers evaluate status from snapshots + current mileage.
 */

export type WarrantyItemKind = "service" | "material";

export type WarrantyLimits = {
  /** Calendar months of coverage. Null/0 = no duration limit. */
  durationMonths: number | null;
  /**
   * Exact calendar days of coverage when the source used days (not months).
   * Null/0 = no day-based limit. Never derived by dividing days by 30.
   */
  durationDays?: number | null;
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

export function normalizeWarrantyDays(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function hasWarrantyCoverage(
  limits: WarrantyLimits & { endsOn?: string | null; expiresAtMileage?: number | null },
): boolean {
  if (
    normalizeWarrantyMonths(limits.durationMonths) ||
    normalizeWarrantyDays(limits.durationDays) ||
    normalizeWarrantyKm(limits.mileageLimit)
  ) {
    return true;
  }
  // Activated DB snapshots are authoritative: ends_on / expires_at_mileage count even if
  // duration_* columns are sparse on older rows.
  if (typeof limits.endsOn === "string" && limits.endsOn.trim()) return true;
  if (limits.expiresAtMileage != null && Number.isFinite(Number(limits.expiresAtMileage))) return true;
  return false;
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

/**
 * Time warranty is expired when the calendar date of `now` is on or after endsOn (YYYY-MM-DD).
 * Boundary: current date >= expiration date → expired (not only the day after).
 */
export function isWarrantyDateExpired(endsOn: string | null | undefined, nowIso?: string): boolean {
  if (!endsOn?.trim()) return false;
  const now = nowIso ? new Date(nowIso) : new Date();
  if (Number.isNaN(now.getTime())) return false;
  return toDateOnlyUtc(now.toISOString()) >= endsOn.trim();
}

/** Add exact calendar days using UTC date parts of the start instant. */
export function addCalendarDaysIso(startIso: string, days: number): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || days <= 0) return startIso;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString();
}

export function buildWarrantyExpiration(params: {
  startsAt: string;
  durationMonths: number | null;
  durationDays?: number | null;
  startMileage: number | null;
  mileageLimit: number | null;
}): { endsOn: string | null; expiresAtMileage: number | null } {
  const months = normalizeWarrantyMonths(params.durationMonths);
  const days = months ? null : normalizeWarrantyDays(params.durationDays);
  const limit = normalizeWarrantyKm(params.mileageLimit);
  const endsOn = months
    ? toDateOnlyUtc(addCalendarMonthsIso(params.startsAt, months))
    : days
      ? toDateOnlyUtc(addCalendarDaysIso(params.startsAt, days))
      : null;
  const startMileage =
    params.startMileage != null && Number.isFinite(Number(params.startMileage)) ? Math.max(0, Math.floor(Number(params.startMileage))) : null;
  // Mileage expiration requires an immutable start mileage; never invent one.
  const expiresAtMileage = limit != null && startMileage != null ? startMileage + limit : null;
  return { endsOn, expiresAtMileage };
}

/**
 * Compact label for a line's configured (or activated) warranty limits.
 * Returns null when there is no coverage — callers should render nothing.
 */
export function formatWarrantyLimitsLabel(
  limits: WarrantyLimits,
  t: (key: string, options?: { count?: number; value?: string }) => string,
  formatKm: (n: number) => string,
): string | null {
  const months = normalizeWarrantyMonths(limits.durationMonths);
  const days = months ? null : normalizeWarrantyDays(limits.durationDays);
  const km = normalizeWarrantyKm(limits.mileageLimit);
  if (!months && !days && !km) return null;
  const parts: string[] = [];
  if (months) parts.push(t("orders.warranty.line.months", { count: months }));
  if (days) parts.push(t("orders.warranty.line.days", { count: days }));
  if (km) parts.push(t("orders.warranty.line.km", { value: formatKm(km) }));
  return t("orders.warranty.line.withCoverage", { value: parts.join(" / ") });
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
  // When both limits exist, the first reached expires the warranty (date OR mileage).
  // Date boundary: calendar day >= endsOn. Mileage boundary: currentMileage >= threshold.
  // Unknown mileage must not invent a value or falsely expire by mileage.
  if (endsOn && isWarrantyDateExpired(endsOn, params.nowIso)) {
    return {
      status: "expired_date",
      expiresOn: endsOn,
      expiresAtMileage: snapshot.expiresAtMileage,
      remainingMileage: remainingMileage(snapshot.expiresAtMileage, params.currentMileage),
      reason: "expired_date",
    };
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

/** Near-expiry thresholds for compact list/board indicators (display only). */
export const WARRANTY_NEAR_EXPIRY_DAYS = 30;
export const WARRANTY_NEAR_EXPIRY_KM = 1000;

export type RemainingDuration = {
  /** Whole calendar months remaining until endsOn (0 when under one month). */
  months: number;
  /** Extra whole days after those months (or total days when months === 0). */
  days: number;
  /** Total whole days remaining (never negative). */
  totalDays: number;
};

/**
 * Calendar remaining duration until endsOn (date-only, UTC day boundary).
 * Returns null when endsOn is missing/invalid or already past.
 */
export function remainingDurationUntil(endsOn: string | null | undefined, nowIso?: string): RemainingDuration | null {
  if (!endsOn?.trim()) return null;
  const now = nowIso ? new Date(nowIso) : new Date();
  if (Number.isNaN(now.getTime())) return null;
  // Align with evaluateWarranty: on/after endsOn there is no remaining duration.
  if (isWarrantyDateExpired(endsOn, nowIso)) return null;

  const end = new Date(`${endsOn.trim()}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;

  const startDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const totalDays = Math.max(0, Math.round((endDay - startDay) / 86_400_000));
  if (totalDays <= 0) return null;

  let months =
    (end.getUTCFullYear() - now.getUTCFullYear()) * 12 + (end.getUTCMonth() - now.getUTCMonth());
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  if (anchor.getTime() > endDay) months -= 1;
  months = Math.max(0, months);
  const afterMonths = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  const days = Math.max(0, Math.round((endDay - afterMonths.getTime()) / 86_400_000));
  return { months, days, totalDays };
}

export type OrderWarrantyIndicatorModel = {
  /** Nothing to render. */
  visible: boolean;
  isWarrantyOrder: boolean;
  coveredItemCount: number;
  status: WarrantyStatusCode;
  evaluation: WarrantyEvaluation | null;
  remaining: RemainingDuration | null;
  nearExpiry: boolean;
  /** Snapshot chosen as the primary (earliest) indicator. */
  primary: WarrantySnapshot | null;
};

function urgencyKey(
  evaluation: WarrantyEvaluation,
  nowMs: number,
): { dateMs: number; mileage: number } {
  const dateMs = evaluation.expiresOn
    ? new Date(`${evaluation.expiresOn}T23:59:59.999Z`).getTime()
    : Number.POSITIVE_INFINITY;
  const mileage =
    evaluation.remainingMileage != null && Number.isFinite(evaluation.remainingMileage)
      ? evaluation.remainingMileage
      : Number.POSITIVE_INFINITY;
  void nowMs;
  return { dateMs: Number.isFinite(dateMs) ? dateMs : Number.POSITIVE_INFINITY, mileage };
}

/**
 * Pick the covered item whose limit is reached first (earliest date, else lowest remaining km).
 * Expired items win over active ones so the card shows the expired state when any linked claim is expired.
 */
export function selectPrimaryWarrantyItem(
  items: readonly { snapshot: WarrantySnapshot; evaluation: WarrantyEvaluation }[],
  nowIso?: string,
): { snapshot: WarrantySnapshot; evaluation: WarrantyEvaluation } | null {
  if (items.length === 0) return null;
  const nowMs = (nowIso ? new Date(nowIso) : new Date()).getTime();
  const ranked = [...items].sort((a, b) => {
    const aExpired = isWarrantyExpired(a.evaluation.status);
    const bExpired = isWarrantyExpired(b.evaluation.status);
    if (aExpired !== bExpired) return aExpired ? -1 : 1;
    const aKey = urgencyKey(a.evaluation, nowMs);
    const bKey = urgencyKey(b.evaluation, nowMs);
    if (aKey.dateMs !== bKey.dateMs) return aKey.dateMs - bKey.dateMs;
    return aKey.mileage - bKey.mileage;
  });
  return ranked[0] ?? null;
}

/**
 * Build the compact list/board indicator model from covered snapshots.
 * `isWarrantyOrder` only affects the Warranty label; coverage comes from snapshots.
 */
export function buildOrderWarrantyIndicator(params: {
  snapshots: readonly WarrantySnapshot[];
  currentMileage?: number | null;
  isWarrantyOrder: boolean;
  nowIso?: string;
}): OrderWarrantyIndicatorModel {
  const covered = params.snapshots.filter((snapshot) => hasWarrantyCoverage(snapshot));
  if (covered.length === 0 && !params.isWarrantyOrder) {
    return {
      visible: false,
      isWarrantyOrder: false,
      coveredItemCount: 0,
      status: "none",
      evaluation: null,
      remaining: null,
      nearExpiry: false,
      primary: null,
    };
  }

  const evaluated = covered.map((snapshot) => ({
    snapshot,
    evaluation: evaluateWarranty({ snapshot, currentMileage: params.currentMileage, nowIso: params.nowIso }),
  }));
  const primary = selectPrimaryWarrantyItem(evaluated, params.nowIso);
  const evaluation = primary?.evaluation ?? null;
  const status = evaluation?.status ?? (params.isWarrantyOrder ? "unavailable" : "none");
  const remaining =
    evaluation && !isWarrantyExpired(status) ? remainingDurationUntil(evaluation.expiresOn, params.nowIso) : null;
  const nearExpiry =
    status === "active" &&
    ((remaining != null && remaining.totalDays <= WARRANTY_NEAR_EXPIRY_DAYS) ||
      (evaluation?.remainingMileage != null && evaluation.remainingMileage <= WARRANTY_NEAR_EXPIRY_KM));

  const visible = params.isWarrantyOrder || covered.length > 0;
  return {
    visible,
    isWarrantyOrder: params.isWarrantyOrder,
    coveredItemCount: covered.length,
    status,
    evaluation,
    remaining,
    nearExpiry,
    primary: primary?.snapshot ?? null,
  };
}
