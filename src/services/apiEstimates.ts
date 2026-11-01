import i18n from "../i18n";
import {
  deleteStage9Row,
  insertStage9Row,
  listStage9Rows,
  nullIfBlank,
  num,
  resolveDefaultStatusId,
  str,
} from "./apiStage9List";

export type EstimateRecord = {
  id: string;
  number: string | null;
  statusId: string | null;
  total: number | null;
  createdAt: string;
};

const estimateColumns = "id, number, status_id, total, created_at";

export function toEstimate(row: Record<string, unknown>): EstimateRecord {
  return {
    id: String(row.id),
    number: str(row.number),
    statusId: str(row.status_id),
    total: num(row.total),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Lists estimates, newest first. Resolves to `isUnavailable` when the `estimates` table is not applied. */
export function getEstimates(workspaceId: string | undefined) {
  return listStage9Rows("estimates", estimateColumns, workspaceId, "created_at", false, toEstimate);
}

export type EstimateInput = {
  /** Optional free-form number; blank leaves `number` null. */
  number: string;
  total: number;
};

const MAX_ESTIMATE_TOTAL = 9_999_999_999_999;

/** Validates an estimate form and builds the insert row for a draft estimate. Pure. */
export function buildEstimateRow(input: EstimateInput) {
  const number = nullIfBlank(input.number);
  if ((number?.length ?? 0) > 64) throw new Error(i18n.t("stage9.estimates.errors.numberTooLong"));
  const total = Math.round((Number(input.total) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(total) || total < 0 || total > MAX_ESTIMATE_TOTAL) {
    throw new Error(i18n.t("stage9.estimates.errors.totalInvalid"));
  }
  // No lines yet: subtotal mirrors the total so list/detail math stays consistent.
  return { number, subtotal: total, total };
}

/** Creates a draft estimate with the workspace's default estimate status (when statuses exist). */
export async function createEstimate(input: EstimateInput, workspaceId: string | undefined) {
  const row = buildEstimateRow(input);
  const statusId = await resolveDefaultStatusId("estimate", workspaceId);
  return insertStage9Row("estimates", statusId ? { ...row, status_id: statusId } : row, workspaceId);
}

/** Soft-deletes an estimate (`deleted_at`). */
export function deleteEstimate(id: string, workspaceId: string | undefined) {
  return deleteStage9Row("estimates", id, workspaceId);
}
