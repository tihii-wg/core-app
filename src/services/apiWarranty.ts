import i18n from "../i18n";
import type { Order } from "../lib/types";
import {
  evaluateWarranty,
  normalizeWarrantyKm,
  normalizeWarrantyMonths,
  type WarrantyEvaluation,
  type WarrantyItemKind,
  type WarrantySnapshot,
  type WarrantyStatusCode,
} from "../features/orders/warranty";
import supabase from "./supabase";

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

function mapSnapshot(row: Record<string, unknown>): WarrantySnapshot {
  return {
    id: String(row.id),
    orderId: String(row.order_id ?? ""),
    itemKind: row.item_kind === "material" ? "material" : "service",
    itemName: String(row.item_name ?? ""),
    orderServiceId: typeof row.order_service_id === "string" ? row.order_service_id : null,
    orderMaterialId: typeof row.order_material_id === "string" ? row.order_material_id : null,
    durationMonths: normalizeWarrantyMonths(row.duration_months),
    mileageLimit: normalizeWarrantyKm(row.mileage_limit),
    startsAt: typeof row.starts_at === "string" ? row.starts_at : typeof row.starts_on === "string" ? `${row.starts_on}T00:00:00.000Z` : "",
    endsOn: typeof row.ends_on === "string" ? row.ends_on : null,
    startMileage: row.start_mileage == null ? null : Number(row.start_mileage),
    expiresAtMileage: row.expires_at_mileage == null ? null : Number(row.expires_at_mileage),
  };
}

export async function getWarrantyRecordsForOrder(workspaceId: string | undefined, orderId: string): Promise<WarrantySnapshot[]> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = orderId.trim();
  if (!id) return [];

  const { data, error } = await supabase
    .from("warranty_records")
    .select(
      "id, order_id, item_kind, item_name, order_service_id, order_material_id, duration_months, mileage_limit, starts_at, starts_on, ends_on, start_mileage, expires_at_mileage",
    )
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(mapSnapshot);
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

  const { data, error } = await supabase
    .from("warranty_order_claims")
    .select("id, warranty_order_id, warranty_record_id, validity_status, accepted_outside_period, current_mileage_at_claim")
    .eq("workspace_id", targetWorkspaceId)
    .eq("warranty_order_id", id);

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const recordIds = rows.map((row) => String(row.warranty_record_id));
  const { data: records, error: recordsError } = await supabase
    .from("warranty_records")
    .select(
      "id, order_id, item_kind, item_name, order_service_id, order_material_id, duration_months, mileage_limit, starts_at, starts_on, ends_on, start_mileage, expires_at_mileage",
    )
    .eq("workspace_id", targetWorkspaceId)
    .in("id", recordIds);

  if (recordsError && !isMissingRelationError(recordsError) && !isMissingColumnError(recordsError)) {
    throw new Error(recordsError.message);
  }
  const byId = new Map(((records ?? []) as Record<string, unknown>[]).map((row) => [String(row.id), mapSnapshot(row)]));

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
    if (!(order.closedAt?.trim() || order.status === "closed")) return false;
    if (order.status === "cancelled") return false;
    return true;
  });
}

export function evaluateSnapshotAgainstVehicle(
  snapshot: WarrantySnapshot,
  currentMileage: number | null | undefined,
  nowIso?: string,
): WarrantyEvaluation {
  return evaluateWarranty({ snapshot, currentMileage, nowIso });
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
  if (!(params.sourceOrder.closedAt?.trim() || params.sourceOrder.status === "closed")) {
    throw new Error(i18n.t("orders.warranty.errors.sourceNotClosed"));
  }

  const records = await getWarrantyRecordsForOrder(workspaceId, params.sourceOrder.id);
  const byId = new Map(records.map((row) => [row.id, row]));

  for (const claim of params.claims) {
    const snapshot = byId.get(claim.warrantyRecordId);
    if (!snapshot) throw new Error(i18n.t("orders.warranty.errors.invalidRecord"));
    const evaluation = evaluateSnapshotAgainstVehicle(snapshot, claim.currentMileageAtClaim ?? params.currentMileage);
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

  const { error: clearError } = await supabase
    .from("warranty_order_claims")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("warranty_order_id", warrantyOrderId);
  if (clearError && !isMissingRelationError(clearError)) throw new Error(clearError.message);

  if (params.claims.length === 0) return;

  const payload = params.claims.map((claim) => {
    const snapshot = byId.get(claim.warrantyRecordId)!;
    const evaluation = evaluateSnapshotAgainstVehicle(snapshot, claim.currentMileageAtClaim ?? params.currentMileage);
    return {
      workspace_id: workspaceId,
      warranty_order_id: warrantyOrderId,
      warranty_record_id: claim.warrantyRecordId,
      validity_status: evaluation.status,
      accepted_outside_period: Boolean(claim.acceptedOutsidePeriod),
      current_mileage_at_claim: claim.currentMileageAtClaim ?? params.currentMileage,
    };
  });

  const { error: insertError } = await supabase.from("warranty_order_claims").insert(payload);
  if (insertError) {
    if (isMissingRelationError(insertError) || isMissingColumnError(insertError)) {
      throw new Error(i18n.t("orders.warranty.errors.schemaRequired"));
    }
    throw new Error(insertError.message);
  }
}

export async function clearWarrantyOrderLink(workspaceId: string | undefined, warrantyOrderId: string): Promise<void> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = warrantyOrderId.trim();
  if (!id) return;

  await supabase.from("warranty_order_claims").delete().eq("workspace_id", targetWorkspaceId).eq("warranty_order_id", id);
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
