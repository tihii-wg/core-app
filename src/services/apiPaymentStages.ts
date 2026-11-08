import i18n from "../i18n";
import type { PaymentStageInput, PaymentStageMode } from "../features/finance/paymentStages";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/** Row shape of public.order_payment_stages. */
export type OrderPaymentStage = {
  id: string;
  workspaceId: string;
  orderId: string;
  position: number;
  name: string;
  mode: PaymentStageMode;
  percent: number | null;
  amount: number | null;
  dueDate: string | null;
  invoiceId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Writable stage fields (computed due/paid amounts are never persisted). */
export type OrderPaymentStageWrite = Pick<PaymentStageInput, "name" | "mode"> & {
  position?: number;
  percent?: number | null;
  amount?: number | null;
  dueDate?: string | null;
  invoiceId?: string | null;
};

const TABLE = "order_payment_stages";
const stageColumns = "id, workspace_id, order_id, position, name, mode, percent, amount, due_date, invoice_id, created_at, updated_at";
const PAGE_SIZE = 1000;

type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null };

function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function readMode(value: unknown): PaymentStageMode {
  return value === "percent" || value === "amount" ? value : "remainder";
}

export function toOrderPaymentStage(row: Record<string, unknown>): OrderPaymentStage {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    orderId: String(row.order_id),
    position: readNumber(row.position) ?? 0,
    name: typeof row.name === "string" ? row.name : "",
    mode: readMode(row.mode),
    percent: readNumber(row.percent),
    amount: readNumber(row.amount),
    dueDate: typeof row.due_date === "string" && row.due_date ? row.due_date.slice(0, 10) : null,
    invoiceId: typeof row.invoice_id === "string" && row.invoice_id ? row.invoice_id : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Maps DB trigger / constraint errors to user-facing i18n messages. */
export function mapPaymentStageDbError(error: DbError, fallbackKey = "finance.paymentStages.errors.saveFailed"): Error {
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (/order_lifecycle:closed_order_immutable/i.test(blob)) {
    return new Error(i18n.t("finance.paymentStages.errors.closedOrderImmutable"));
  }
  if (/order_payment_stages:workspace_mismatch/i.test(blob)) {
    return new Error(i18n.t("finance.paymentStages.errors.workspaceMismatch"));
  }
  if (/order_payment_stages:invoice_mismatch/i.test(blob)) {
    return new Error(i18n.t("finance.paymentStages.errors.invoiceMismatch"));
  }
  if (/order_payment_stages:order_not_found/i.test(blob)) {
    return new Error(i18n.t("finance.paymentStages.errors.orderNotFound"));
  }
  if (isMissingTableError(error, TABLE)) {
    return new Error(i18n.t("finance.paymentStages.errors.schemaRequired"));
  }
  if (error.code === "23514" || /order_payment_stages_(values|name_len|mode|position)_check|order_payment_stages_one_remainder/i.test(blob)) {
    return new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
  }
  return new Error(error.message || i18n.t(fallbackKey as never));
}

function roundTo2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Normalizes a write payload to the shape enforced by order_payment_stages_values_check. */
function normalizeStageWrite(stage: OrderPaymentStageWrite): Required<Omit<OrderPaymentStageWrite, "position">> & { position?: number } {
  const name = stage.name?.trim() ?? "";
  if (!name) throw new Error(i18n.t("finance.paymentStages.errors.nameRequired"));
  const mode = stage.mode;
  let percent: number | null = null;
  let amount: number | null = null;
  if (mode === "percent") {
    percent = roundTo2(Number(stage.percent ?? 0));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
    }
  } else if (mode === "amount") {
    amount = roundTo2(Number(stage.amount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
    }
  }
  return {
    name: name.slice(0, 100),
    mode,
    percent,
    amount,
    dueDate: stage.dueDate?.trim() ? stage.dueDate.trim().slice(0, 10) : null,
    invoiceId: stage.invoiceId ?? null,
    position: stage.position,
  };
}

function toInsertRow(orderId: string, workspaceId: string, stage: ReturnType<typeof normalizeStageWrite>, position: number) {
  return {
    workspace_id: workspaceId,
    order_id: orderId,
    position,
    name: stage.name,
    mode: stage.mode,
    percent: stage.percent,
    amount: stage.amount,
    due_date: stage.dueDate,
    invoice_id: stage.invoiceId,
  };
}

/** Stages for one order, ordered by position. Missing table → []. */
export async function getOrderPaymentStages(orderId: string | undefined, workspaceId: string | undefined): Promise<OrderPaymentStage[]> {
  const resolved = requireWorkspaceId(workspaceId);
  const id = orderId?.trim() ?? "";
  if (!id) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select(stageColumns)
    .eq("workspace_id", resolved)
    .eq("order_id", id)
    .order("position", { ascending: true });
  if (error) {
    if (isMissingTableError(error, TABLE)) return [];
    throw mapPaymentStageDbError(error, "finance.paymentStages.errors.loadFailed");
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toOrderPaymentStage);
}

/** All stages of a workspace (dashboard: upcoming / overdue). Missing table → []. */
export async function getOrderPaymentStagesForWorkspace(workspaceId: string | undefined): Promise<OrderPaymentStage[]> {
  const resolved = requireWorkspaceId(workspaceId);
  const rows: OrderPaymentStage[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(stageColumns)
      .eq("workspace_id", resolved)
      .order("order_id", { ascending: true })
      .order("position", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (isMissingTableError(error, TABLE)) return [];
      throw mapPaymentStageDbError(error, "finance.paymentStages.errors.loadFailed");
    }
    const page = ((data ?? []) as unknown as Record<string, unknown>[]).map(toOrderPaymentStage);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Replaces all stages of an order with `stages` (positions re-numbered 0..n-1 in array order).
 * Delete + insert; if the insert fails the previous stages are restored best-effort.
 */
export async function replaceOrderPaymentStages(
  orderId: string,
  workspaceId: string | undefined,
  stages: readonly OrderPaymentStageWrite[],
): Promise<OrderPaymentStage[]> {
  const resolved = requireWorkspaceId(workspaceId);
  const normalized = stages.map(normalizeStageWrite);
  if (normalized.filter((stage) => stage.mode === "remainder").length > 1) {
    throw new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
  }

  const { data: previousData, error: loadError } = await supabase
    .from(TABLE)
    .select(stageColumns)
    .eq("workspace_id", resolved)
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  if (loadError) throw mapPaymentStageDbError(loadError);
  const previous = ((previousData ?? []) as unknown as Record<string, unknown>[]).map(toOrderPaymentStage);

  if (previous.length > 0) {
    const { error: deleteError } = await supabase.from(TABLE).delete().eq("workspace_id", resolved).eq("order_id", orderId);
    if (deleteError) throw mapPaymentStageDbError(deleteError);
  }
  if (normalized.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .insert(normalized.map((stage, index) => toInsertRow(orderId, resolved, stage, index)))
    .select(stageColumns);
  if (error) {
    if (previous.length > 0) {
      // Best-effort restore so a failed replace never leaves the order without its stages.
      await supabase.from(TABLE).insert(
        previous.map((stage) => ({
          id: stage.id,
          workspace_id: stage.workspaceId,
          order_id: stage.orderId,
          position: stage.position,
          name: stage.name,
          mode: stage.mode,
          percent: stage.percent,
          amount: stage.amount,
          due_date: stage.dueDate,
          invoice_id: stage.invoiceId,
        })),
      );
    }
    throw mapPaymentStageDbError(error);
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toOrderPaymentStage).sort((a, b) => a.position - b.position);
}

/** Appends a stage (or inserts at `position` when given). */
export async function createOrderPaymentStage(
  orderId: string,
  workspaceId: string | undefined,
  stage: OrderPaymentStageWrite,
): Promise<OrderPaymentStage> {
  const resolved = requireWorkspaceId(workspaceId);
  const normalized = normalizeStageWrite(stage);

  let position = normalized.position;
  if (position == null || !Number.isFinite(position)) {
    const { data: last, error: lastError } = await supabase
      .from(TABLE)
      .select("position")
      .eq("workspace_id", resolved)
      .eq("order_id", orderId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError && !isMissingTableError(lastError, TABLE)) throw mapPaymentStageDbError(lastError);
    position = last ? (readNumber((last as { position?: unknown }).position) ?? -1) + 1 : 0;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert(toInsertRow(orderId, resolved, normalized, Math.max(0, Math.trunc(position))))
    .select(stageColumns)
    .single();
  if (error) throw mapPaymentStageDbError(error);
  return toOrderPaymentStage(data as unknown as Record<string, unknown>);
}

export async function updateOrderPaymentStage(
  stageId: string,
  workspaceId: string | undefined,
  patch: Partial<OrderPaymentStageWrite>,
): Promise<OrderPaymentStage> {
  const resolved = requireWorkspaceId(workspaceId);
  const update: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error(i18n.t("finance.paymentStages.errors.nameRequired"));
    update.name = name.slice(0, 100);
  }
  if (patch.mode !== undefined) {
    // Mode changes must carry their matching value so the DB values check holds.
    const normalized = normalizeStageWrite({ name: "x", mode: patch.mode, percent: patch.percent, amount: patch.amount });
    update.mode = normalized.mode;
    update.percent = normalized.percent;
    update.amount = normalized.amount;
  } else if (patch.percent !== undefined || patch.amount !== undefined) {
    if (patch.percent !== undefined) {
      const percent = patch.percent == null ? null : roundTo2(Number(patch.percent));
      if (percent != null && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
        throw new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
      }
      update.percent = percent;
    }
    if (patch.amount !== undefined) {
      const amount = patch.amount == null ? null : roundTo2(Number(patch.amount));
      if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
        throw new Error(i18n.t("finance.paymentStages.errors.invalidValue"));
      }
      update.amount = amount;
    }
  }
  if (patch.position !== undefined) update.position = Math.max(0, Math.trunc(patch.position));
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate?.trim() ? patch.dueDate.trim().slice(0, 10) : null;
  if (patch.invoiceId !== undefined) update.invoice_id = patch.invoiceId || null;

  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", stageId)
    .eq("workspace_id", resolved)
    .select(stageColumns)
    .maybeSingle();
  if (error) throw mapPaymentStageDbError(error);
  if (!data) throw new Error(i18n.t("finance.paymentStages.errors.orderNotFound"));
  return toOrderPaymentStage(data as unknown as Record<string, unknown>);
}

export async function deleteOrderPaymentStage(stageId: string, workspaceId: string | undefined): Promise<void> {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase.from(TABLE).delete().eq("id", stageId).eq("workspace_id", resolved);
  if (error) throw mapPaymentStageDbError(error);
}

/** Links (or unlinks with null) the invoice issued for a stage. DB validates workspace / order match. */
export async function linkStageInvoice(
  stageId: string,
  invoiceId: string | null,
  workspaceId: string | undefined,
): Promise<OrderPaymentStage> {
  return updateOrderPaymentStage(stageId, workspaceId, { invoiceId });
}
