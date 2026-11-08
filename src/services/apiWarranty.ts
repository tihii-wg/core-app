import i18n from "../i18n";
import { assertStoredMileage, MileageParseError } from "../lib/mileage";
import type { MileageUnit, Order } from "../lib/types";
import {
  buildOrderWarrantyIndicator,
  evaluateWarranty,
  isWarrantySourceFormallyClosed,
  normalizeWarrantyDays,
  normalizeWarrantyKm,
  normalizeWarrantyMonths,
  type OrderWarrantyIndicatorModel,
  type WarrantyEvaluation,
  type WarrantyItemKind,
  type WarrantySnapshot,
  type WarrantyStatusCode,
} from "../features/orders/warranty";
function mapPausedWarrantyClaimError(error: {
  message?: string;
  details?: string | null;
  hint?: string | null;
}): Error | null {
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (/warranty:paused_source_not_closed/i.test(blob)) {
    return new Error(i18n.t("orders.warranty.errors.pausedSourceNotClosed"));
  }
  return null;
}
import { parseMileageUnit } from "../features/vehicles/vehicleMileage";
import supabase from "./supabase";

function storedMileageOrThrow(value: number | null | undefined): number | null {
  try {
    return assertStoredMileage(value);
  } catch (error) {
    if (error instanceof MileageParseError) throw new Error(i18n.t(error.i18nKey));
    throw error;
  }
}

const WARRANTY_RECORD_COLUMNS =
  "id, order_id, item_kind, item_name, order_service_id, order_material_id, duration_months, duration_days, mileage_limit, mileage_unit, starts_at, starts_on, ends_on, start_mileage, expires_at_mileage";

/** Pre-duration_days schema (20261104250000 without 20261104260000 hardening). */
const WARRANTY_RECORD_COLUMNS_LEGACY =
  "id, order_id, item_kind, item_name, order_service_id, order_material_id, duration_months, mileage_limit, starts_at, starts_on, ends_on, start_mileage, expires_at_mileage";

/** duration_days present but mileage_unit not yet applied. */
const WARRANTY_RECORD_COLUMNS_NO_MILEAGE_UNIT =
  "id, order_id, item_kind, item_name, order_service_id, order_material_id, duration_months, duration_days, mileage_limit, starts_at, starts_on, ends_on, start_mileage, expires_at_mileage";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function isMissingRelationError(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column|schema cache/i.test(error.message ?? "");
}

function isDurationDaysMissingError(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && isMissingColumnError(error) && /duration_days/i.test(error.message ?? ""));
}

function isMileageUnitMissingError(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && isMissingColumnError(error) && /mileage_unit/i.test(error.message ?? ""));
}

function mapSnapshot(row: Record<string, unknown>): WarrantySnapshot {
  return {
    id: String(row.id),
    orderId: String(row.order_id ?? ""),
    itemKind: row.item_kind === "material" ? "material" : "service",
    itemName: String(row.item_name ?? ""),
    orderServiceId: typeof row.order_service_id === "string" ? row.order_service_id : null,
    orderMaterialId: typeof row.order_material_id === "string" ? row.order_material_id : null,
    durationMonths: normalizeWarrantyMonths(row.duration_months),
    durationDays: normalizeWarrantyDays(row.duration_days),
    mileageLimit: normalizeWarrantyKm(row.mileage_limit),
    mileageUnit: parseMileageUnit(row.mileage_unit) ?? "km",
    startsAt: typeof row.starts_at === "string" ? row.starts_at : typeof row.starts_on === "string" ? `${row.starts_on}T00:00:00.000Z` : "",
    endsOn: typeof row.ends_on === "string" ? row.ends_on : null,
    startMileage: row.start_mileage == null ? null : Number(row.start_mileage),
    expiresAtMileage: row.expires_at_mileage == null ? null : Number(row.expires_at_mileage),
  };
}

type WarrantyRecordFilter =
  | { kind: "order_ids"; orderIds: string[] }
  | { kind: "ids"; ids: string[] }
  | { kind: "order_id"; orderId: string; orderByCreated?: boolean };

/**
 * Loads warranty_records with duration_days when present; falls back to the pre-hardening
 * column list. Unlike the old indicator path, does NOT convert schema errors into [].
 */
async function fetchWarrantyRecordRows(
  workspaceId: string,
  filter: WarrantyRecordFilter,
): Promise<Record<string, unknown>[]> {
  const run = async (columns: string) => {
    let query = supabase.from("warranty_records").select(columns).eq("workspace_id", workspaceId);
    if (filter.kind === "order_ids") query = query.in("order_id", filter.orderIds);
    else if (filter.kind === "ids") query = query.in("id", filter.ids);
    else {
      query = query.eq("order_id", filter.orderId);
      if (filter.orderByCreated) query = query.order("created_at", { ascending: true });
    }
    return query;
  };

  let { data, error } = await run(WARRANTY_RECORD_COLUMNS);
  if (isMileageUnitMissingError(error)) {
    ({ data, error } = await run(WARRANTY_RECORD_COLUMNS_NO_MILEAGE_UNIT));
  }
  if (isDurationDaysMissingError(error)) {
    ({ data, error } = await run(WARRANTY_RECORD_COLUMNS_LEGACY));
  }
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

export async function getWarrantyRecordsForOrder(workspaceId: string | undefined, orderId: string): Promise<WarrantySnapshot[]> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = orderId.trim();
  if (!id) return [];

  try {
    const rows = await fetchWarrantyRecordRows(targetWorkspaceId, { kind: "order_id", orderId: id, orderByCreated: true });
    return rows.map(mapSnapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Detail panel: soft-fail only when the warranty schema is not deployed yet.
    if (/PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(message)) {
      return [];
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

export type WarrantyClaimInput = {
  warrantyRecordId: string;
  acceptedOutsidePeriod?: boolean;
  currentMileageAtClaim?: number | null;
};

export type WarrantyClaimRow = {
  id: string;
  warrantyOrderId: string;
  warrantyRecordId: string;
  validityStatus: WarrantyStatusCode;
  acceptedOutsidePeriod: boolean;
  currentMileageAtClaim: number | null;
  record?: WarrantySnapshot;
};

export async function getWarrantyClaimsForOrder(workspaceId: string | undefined, warrantyOrderId: string): Promise<WarrantyClaimRow[]> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = warrantyOrderId.trim();
  if (!id) return [];

  let { data, error } = await supabase
    .from("warranty_order_claims")
    .select("id, warranty_order_id, warranty_record_id, validity_status, accepted_outside_period, current_mileage_at_claim, is_active")
    .eq("workspace_id", targetWorkspaceId)
    .eq("warranty_order_id", id)
    .eq("is_active", true);

  if (error && isMissingColumnError(error) && /is_active/i.test(error.message ?? "")) {
    const legacy = await supabase
      .from("warranty_order_claims")
      .select("id, warranty_order_id, warranty_record_id, validity_status, accepted_outside_period, current_mileage_at_claim")
      .eq("workspace_id", targetWorkspaceId)
      .eq("warranty_order_id", id);
    data = legacy.data as typeof data;
    error = legacy.error;
  }

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const recordIds = rows.map((row) => String(row.warranty_record_id));
  let records: Record<string, unknown>[] = [];
  try {
    records = await fetchWarrantyRecordRows(targetWorkspaceId, { kind: "ids", ids: recordIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(message)) {
      records = [];
    } else {
      throw error instanceof Error ? error : new Error(message);
    }
  }
  const byId = new Map(records.map((row) => [String(row.id), mapSnapshot(row)]));

  return rows.map((row) => ({
    id: String(row.id),
    warrantyOrderId: String(row.warranty_order_id),
    warrantyRecordId: String(row.warranty_record_id),
    validityStatus: String(row.validity_status) as WarrantyStatusCode,
    acceptedOutsidePeriod: Boolean(row.accepted_outside_period),
    currentMileageAtClaim: row.current_mileage_at_claim == null ? null : Number(row.current_mileage_at_claim),
    record: byId.get(String(row.warranty_record_id)),
  }));
}

/**
 * Batched warranty indicator payloads for a page of orders (no N+1).
 * - Warranty claim orders: snapshots from warranty_order_claims → warranty_records
 * - Original orders: snapshots from warranty_records for that order_id
 * - Vehicle mileage: one vehicles query for distinct vehicle ids on the page
 */
export async function getOrdersWarrantyIndicatorMap(
  workspaceId: string | undefined,
  orders: readonly Pick<
    Order,
    | "id"
    | "status"
    | "warrantySourceOrderId"
    | "vehicleId"
    | "vehicleMileageSnapshot"
    | "vehicleMileageUnitSnapshot"
    | "closedAt"
  >[],
  nowIso?: string,
): Promise<Record<string, OrderWarrantyIndicatorModel>> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const result: Record<string, OrderWarrantyIndicatorModel> = {};
  if (orders.length === 0) return result;

  const claimOrderIds = [...new Set(orders.filter((order) => order.warrantySourceOrderId).map((order) => order.id))];
  const originalOrderIds = [...new Set(orders.filter((order) => !order.warrantySourceOrderId).map((order) => order.id))];

  const snapshotsByOrderId = new Map<string, WarrantySnapshot[]>();
  const claimRecordIdsByOrderId = new Map<string, string[]>();

  if (claimOrderIds.length > 0) {
    let { data: claims, error: claimsError } = await supabase
      .from("warranty_order_claims")
      .select("warranty_order_id, warranty_record_id, is_active")
      .eq("workspace_id", targetWorkspaceId)
      .in("warranty_order_id", claimOrderIds)
      .eq("is_active", true);
    if (claimsError && isMissingColumnError(claimsError) && /is_active/i.test(claimsError.message ?? "")) {
      const legacy = await supabase
        .from("warranty_order_claims")
        .select("warranty_order_id, warranty_record_id")
        .eq("workspace_id", targetWorkspaceId)
        .in("warranty_order_id", claimOrderIds);
      claims = legacy.data as typeof claims;
      claimsError = legacy.error;
    }
    if (claimsError) {
      // Claims table may be undeployed; originals still load below. Other errors surface.
      if (!(isMissingRelationError(claimsError) || /Could not find the table|does not exist/i.test(claimsError.message ?? ""))) {
        throw new Error(claimsError.message);
      }
    } else {
      const recordIds = new Set<string>();
      for (const row of (claims ?? []) as Record<string, unknown>[]) {
        const orderId = String(row.warranty_order_id ?? "");
        const recordId = String(row.warranty_record_id ?? "");
        if (!orderId || !recordId) continue;
        recordIds.add(recordId);
        const list = claimRecordIdsByOrderId.get(orderId) ?? [];
        list.push(recordId);
        claimRecordIdsByOrderId.set(orderId, list);
      }
      if (recordIds.size > 0) {
        // Throws on real DB errors; falls back when duration_days is absent.
        const records = await fetchWarrantyRecordRows(targetWorkspaceId, { kind: "ids", ids: [...recordIds] });
        const byId = new Map(records.map((row) => [String(row.id), mapSnapshot(row)]));
        for (const [orderId, ids] of claimRecordIdsByOrderId) {
          snapshotsByOrderId.set(
            orderId,
            ids.map((id) => byId.get(id)).filter((row): row is WarrantySnapshot => Boolean(row)),
          );
        }
      }
    }
  }

  if (originalOrderIds.length > 0) {
    // Throws on real DB errors; falls back when duration_days is absent — never silent empty map.
    const records = await fetchWarrantyRecordRows(targetWorkspaceId, { kind: "order_ids", orderIds: originalOrderIds });
    for (const row of records) {
      const snapshot = mapSnapshot(row);
      const list = snapshotsByOrderId.get(snapshot.orderId) ?? [];
      list.push(snapshot);
      snapshotsByOrderId.set(snapshot.orderId, list);
    }
  }

  const vehicleIds = [
    ...new Set(orders.map((order) => order.vehicleId?.trim()).filter((id): id is string => Boolean(id))),
  ];
  const mileageByVehicleId = new Map<string, { mileage: number; unit: MileageUnit | null }>();
  if (vehicleIds.length > 0) {
    const { data: vehicles, error: vehiclesError } = await supabase
      .from("vehicles")
      .select("id, current_mileage, mileage_unit")
      .eq("workspace_id", targetWorkspaceId)
      .in("id", vehicleIds);
    if (vehiclesError) {
      // Mileage is optional for time-only warranties; surface unexpected errors.
      if (!(isMissingRelationError(vehiclesError) || isMissingColumnError(vehiclesError))) {
        throw new Error(vehiclesError.message);
      }
    } else {
      for (const row of (vehicles ?? []) as Record<string, unknown>[]) {
        const id = String(row.id ?? "");
        const mileage = row.current_mileage == null ? null : Number(row.current_mileage);
        if (id && mileage != null && Number.isFinite(mileage)) {
          mileageByVehicleId.set(id, { mileage: Math.floor(mileage), unit: parseMileageUnit(row.mileage_unit) });
        }
      }
    }
  }

  // Source-order closedness for claim snapshots (records live on the original order).
  const sourceOrderIds = new Set<string>();
  for (const snapshots of snapshotsByOrderId.values()) {
    for (const snapshot of snapshots) {
      if (snapshot.orderId) sourceOrderIds.add(snapshot.orderId);
    }
  }
  for (const order of orders) {
    if (!order.warrantySourceOrderId) sourceOrderIds.add(order.id);
  }
  const sourceClosedByOrderId = new Map<string, boolean>();
  for (const order of orders) {
    if (!order.warrantySourceOrderId) {
      sourceClosedByOrderId.set(order.id, isWarrantySourceFormallyClosed(order));
    }
  }
  const missingSourceIds = [...sourceOrderIds].filter((id) => !sourceClosedByOrderId.has(id));
  if (missingSourceIds.length > 0) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from("orders")
      .select("id, status, closed_at")
      .eq("workspace_id", targetWorkspaceId)
      .in("id", missingSourceIds);
    if (sourceError) {
      if (!(isMissingRelationError(sourceError) || isMissingColumnError(sourceError))) {
        throw new Error(sourceError.message);
      }
    } else {
      for (const row of (sourceRows ?? []) as Record<string, unknown>[]) {
        const id = String(row.id ?? "");
        if (!id) continue;
        sourceClosedByOrderId.set(
          id,
          isWarrantySourceFormallyClosed({
            status: typeof row.status === "string" ? row.status : "",
            closedAt: typeof row.closed_at === "string" ? row.closed_at : null,
          }),
        );
      }
    }
  }

  for (const order of orders) {
    const vehicleId = order.vehicleId?.trim() || "";
    const fromVehicle = vehicleId ? mileageByVehicleId.get(vehicleId) : undefined;
    const currentMileage =
      fromVehicle?.mileage ??
      (order.vehicleMileageSnapshot != null && Number.isFinite(order.vehicleMileageSnapshot)
        ? Math.floor(order.vehicleMileageSnapshot)
        : null);
    const currentMileageUnit =
      fromVehicle?.unit ?? parseMileageUnit(order.vehicleMileageUnitSnapshot) ?? "km";
    const snapshots = snapshotsByOrderId.get(order.id) ?? [];
    result[order.id] = buildOrderWarrantyIndicator({
      snapshots,
      currentMileage,
      currentMileageUnit,
      isWarrantyOrder: Boolean(order.warrantySourceOrderId),
      nowIso,
      sourceOrderClosed: order.warrantySourceOrderId
        ? sourceClosedByOrderId
        : isWarrantySourceFormallyClosed(order),
    });
  }

  return result;
}

/**
 * Eligible originals for a warranty claim: same workspace, client, vehicle; formally closed.
 */
export function filterEligibleWarrantySourceOrders(params: {
  candidates: readonly Order[];
  clientId: string;
  vehicleId: string | null | undefined;
  excludeOrderId: string;
}): Order[] {
  const clientId = params.clientId.trim();
  const vehicleId = params.vehicleId?.trim() || null;
  return params.candidates.filter((order) => {
    if (order.id === params.excludeOrderId) return false;
    if (order.clientId !== clientId) return false;
    if ((order.vehicleId?.trim() || null) !== vehicleId) return false;
    if (!isWarrantySourceFormallyClosed(order)) return false;
    return true;
  });
}

export function evaluateSnapshotAgainstVehicle(
  snapshot: WarrantySnapshot,
  currentMileage: number | null | undefined,
  nowIso?: string,
  currentMileageUnit?: MileageUnit | null,
  sourceOrderClosed?: boolean,
): WarrantyEvaluation {
  return evaluateWarranty({ snapshot, currentMileage, currentMileageUnit, nowIso, sourceOrderClosed });
}

/**
 * Persist warranty source link + claimed items for a warranty order.
 * Validates same workspace/client/vehicle via the provided original order snapshot.
 */
export async function saveWarrantyOrderLink(params: {
  workspaceId: string | undefined;
  warrantyOrderId: string;
  sourceOrder: Pick<Order, "id" | "clientId" | "vehicleId" | "closedAt" | "status" | "workspace_id">;
  warrantyOrder: Pick<Order, "clientId" | "vehicleId" | "workspace_id">;
  claims: WarrantyClaimInput[];
  currentMileage: number | null;
}): Promise<void> {
  const workspaceId = requireWorkspaceId(params.workspaceId);
  const warrantyOrderId = params.warrantyOrderId.trim();
  if (!warrantyOrderId) throw new Error(i18n.t("orders.errors.notFoundOrForbidden"));

  if (params.sourceOrder.workspace_id && params.sourceOrder.workspace_id !== workspaceId) {
    throw new Error(i18n.t("orders.warranty.errors.crossWorkspace"));
  }
  if (params.warrantyOrder.clientId !== params.sourceOrder.clientId) {
    throw new Error(i18n.t("orders.warranty.errors.crossClient"));
  }
  if ((params.warrantyOrder.vehicleId?.trim() || null) !== (params.sourceOrder.vehicleId?.trim() || null)) {
    throw new Error(i18n.t("orders.warranty.errors.crossVehicle"));
  }
  const sourceClosed = isWarrantySourceFormallyClosed(params.sourceOrder);
  if (!sourceClosed) {
    throw new Error(i18n.t("orders.warranty.errors.pausedSourceNotClosed"));
  }

  const records = await getWarrantyRecordsForOrder(workspaceId, params.sourceOrder.id);
  const byId = new Map(records.map((row) => [row.id, row]));

  for (const claim of params.claims) {
    const snapshot = byId.get(claim.warrantyRecordId);
    if (!snapshot) throw new Error(i18n.t("orders.warranty.errors.invalidRecord"));
    const evaluation = evaluateSnapshotAgainstVehicle(
      snapshot,
      claim.currentMileageAtClaim ?? params.currentMileage,
      undefined,
      undefined,
      true,
    );
    if (
      (evaluation.status === "expired_date" || evaluation.status === "expired_mileage") &&
      !claim.acceptedOutsidePeriod
    ) {
      throw new Error(i18n.t("orders.warranty.errors.expiredNeedsConfirmation"));
    }
  }

  const { error: orderError } = await supabase
    .from("orders")
    .update({ warranty_source_order_id: params.sourceOrder.id })
    .eq("id", warrantyOrderId)
    .eq("workspace_id", workspaceId);
  if (orderError) {
    if (isMissingColumnError(orderError)) throw new Error(i18n.t("orders.warranty.errors.schemaRequired"));
    throw new Error(orderError.message);
  }

  // Prefer immutable claim history: upsert active claims and soft-deactivate others.
  // Hard DELETE requires orders.delete and is not used for ordinary link edits.
  const selectedIds = params.claims.map((claim) => claim.warrantyRecordId);

  if (selectedIds.length > 0) {
    const payload = params.claims.map((claim) => {
      const snapshot = byId.get(claim.warrantyRecordId)!;
      const evaluation = evaluateSnapshotAgainstVehicle(snapshot, claim.currentMileageAtClaim ?? params.currentMileage);
      return {
        workspace_id: workspaceId,
        warranty_order_id: warrantyOrderId,
        warranty_record_id: claim.warrantyRecordId,
        validity_status: evaluation.status,
        accepted_outside_period: Boolean(claim.acceptedOutsidePeriod),
        current_mileage_at_claim: storedMileageOrThrow(claim.currentMileageAtClaim ?? params.currentMileage),
        is_active: true,
      };
    });

    const { error: upsertError } = await supabase.from("warranty_order_claims").upsert(payload, {
      onConflict: "warranty_order_id,warranty_record_id",
    });
    if (upsertError) {
      const mapped = mapPausedWarrantyClaimError(upsertError);
      if (mapped) throw mapped;
      if (isMissingRelationError(upsertError) || isMissingColumnError(upsertError)) {
        // Pre-hardening schema: fall back to insert-only when unique upsert / is_active unavailable.
        const legacyPayload = payload.map(({ is_active: _active, ...rest }) => rest);
        const { error: insertError } = await supabase.from("warranty_order_claims").insert(legacyPayload);
        if (insertError) {
          const insertMapped = mapPausedWarrantyClaimError(insertError);
          if (insertMapped) throw insertMapped;
          if (isMissingRelationError(insertError) || isMissingColumnError(insertError)) {
            throw new Error(i18n.t("orders.warranty.errors.schemaRequired"));
          }
          throw new Error(insertError.message);
        }
      } else {
        throw new Error(upsertError.message);
      }
    }
  }

  // Soft-deactivate claims no longer selected (or all when saving empty selection).
  let deactivateQuery = supabase
    .from("warranty_order_claims")
    .update({ is_active: false })
    .eq("workspace_id", workspaceId)
    .eq("warranty_order_id", warrantyOrderId);
  if (selectedIds.length > 0) {
    deactivateQuery = deactivateQuery.not("warranty_record_id", "in", `(${selectedIds.join(",")})`);
  }
  const { error: deactivateError } = await deactivateQuery;
  if (deactivateError && !(isMissingRelationError(deactivateError) || (isMissingColumnError(deactivateError) && /is_active/i.test(deactivateError.message ?? "")))) {
    throw new Error(deactivateError.message);
  }
}

export async function clearWarrantyOrderLink(workspaceId: string | undefined, warrantyOrderId: string): Promise<void> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = warrantyOrderId.trim();
  if (!id) return;

  // Soft-deactivate claim history; do not DELETE (editors lack claim DELETE under hardened RLS).
  const { error: deactivateError } = await supabase
    .from("warranty_order_claims")
    .update({ is_active: false })
    .eq("workspace_id", targetWorkspaceId)
    .eq("warranty_order_id", id);
  if (
    deactivateError &&
    !(isMissingRelationError(deactivateError) || (isMissingColumnError(deactivateError) && /is_active/i.test(deactivateError.message ?? "")))
  ) {
    throw new Error(deactivateError.message);
  }

  const { error } = await supabase.from("orders").update({ warranty_source_order_id: null }).eq("id", id).eq("workspace_id", targetWorkspaceId);
  if (error && !isMissingColumnError(error)) throw new Error(error.message);
}

export async function getWarrantyDeleteBlocker(workspaceId: string | undefined, orderId: string): Promise<string | null> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("order_delete_blocked_by_warranty", {
    p_workspace_id: targetWorkspaceId,
    p_order_id: orderId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      // Fallback: client-side check when helper RPC is not applied yet.
      const { data: children, error: childError } = await supabase
        .from("orders")
        .select("id, number")
        .eq("workspace_id", targetWorkspaceId)
        .eq("warranty_source_order_id", orderId);
      if (childError) {
        if (isMissingColumnError(childError) || isMissingRelationError(childError)) return null;
        throw new Error(childError.message);
      }
      if (children && children.length > 0) {
        const labels = children.map((row) => (typeof row.number === "string" && row.number.trim() ? row.number : String(row.id))).join(", ");
        return `order_delete:has_warranty_orders:${labels}`;
      }
      return null;
    }
    throw new Error(error.message);
  }
  return typeof data === "string" && data.trim() ? data : null;
}

export type { WarrantyItemKind, WarrantySnapshot, WarrantyEvaluation, WarrantyStatusCode };
