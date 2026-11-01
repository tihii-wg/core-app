import i18n from "../i18n";
import {
  isClientDiscountTarget,
  parseDiscountPercent,
  type ClientDiscount,
  type ClientDiscountMode,
  type ClientDiscountTarget,
} from "../features/clients/clientDiscounts";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/**
 * `client_discounts` (crm_ro_v1): one row per (client_id, target), unique constraint `(client_id, target)`.
 * RLS: view '*', write `contacts.edit_discounts`. A missing table / unreadable rows degrade to `available: false`.
 */
export type ClientDiscountsResult = { available: boolean; rows: ClientDiscount[] };

const discountColumns = "id, client_id, target, mode, percent, price_type_id, updated_at";

export function toClientDiscount(row: Record<string, unknown>): ClientDiscount | null {
  if (!isClientDiscountTarget(row.target)) return null;
  const percent = row.percent == null ? null : Number(row.percent);
  return {
    id: String(row.id),
    clientId: typeof row.client_id === "string" ? row.client_id : "",
    target: row.target,
    mode: (row.mode === "price_type" ? "price_type" : "fixed") as ClientDiscountMode,
    percent: percent != null && Number.isFinite(percent) ? percent : null,
    priceTypeId: typeof row.price_type_id === "string" ? row.price_type_id : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export async function getClientDiscounts(workspaceId: string | undefined, clientId: string): Promise<ClientDiscountsResult> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!clientId.trim()) return { available: false, rows: [] };

  const { data, error } = await supabase
    .from("client_discounts")
    .select(discountColumns)
    .eq("workspace_id", resolved)
    .eq("client_id", clientId);

  if (error) return { available: false, rows: [] };
  const rows = ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
    const parsed = toClientDiscount(row);
    return parsed ? [parsed] : [];
  });
  return { available: true, rows };
}

function writeError(error: { code?: string; message?: string }) {
  if (isMissingTableError(error, "client_discounts")) return new Error(i18n.t("clients.extras.errors.tableMissing"));
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")) {
    return new Error(i18n.t("clients.extras.discounts.errors.permission"));
  }
  return new Error(error.message || i18n.t("clients.extras.errors.writeFailed"));
}

export type UpsertClientDiscountInput = {
  target: ClientDiscountTarget;
  /** Raw text from the input; blank is rejected (use `deleteClientDiscount` to clear). */
  percent: string;
};

/**
 * Creates or updates the fixed-percent discount of one target (`on conflict (client_id, target)`).
 * Switching a `price_type` row to a percent clears `price_type_id` so the row stays consistent.
 */
export async function upsertClientDiscount(
  workspaceId: string | undefined,
  clientId: string,
  input: UpsertClientDiscountInput,
): Promise<ClientDiscount> {
  const resolved = requireWorkspaceId(workspaceId);
  const client = clientId.trim();
  if (!client) throw new Error(i18n.t("clients.extras.errors.noClient"));
  if (!isClientDiscountTarget(input.target)) throw new Error(i18n.t("clients.extras.discounts.errors.invalidTarget"));

  const percent = parseDiscountPercent(input.percent);
  if (percent === null || Number.isNaN(percent)) throw new Error(i18n.t("clients.extras.discounts.errors.invalidPercent"));

  const { data, error } = await supabase
    .from("client_discounts")
    .upsert(
      {
        workspace_id: resolved,
        client_id: client,
        target: input.target,
        mode: "fixed",
        percent,
        price_type_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,target" },
    )
    .select(discountColumns)
    .single();

  if (error) throw writeError(error);
  const parsed = toClientDiscount(data as Record<string, unknown>);
  if (!parsed) throw new Error(i18n.t("clients.extras.errors.writeFailed"));
  return parsed;
}

/** `client_discounts` has no `deleted_at`: clearing a discount is a hard delete. */
export async function deleteClientDiscount(workspaceId: string | undefined, clientId: string, target: ClientDiscountTarget): Promise<void> {
  const resolved = requireWorkspaceId(workspaceId);
  const client = clientId.trim();
  if (!client) throw new Error(i18n.t("clients.extras.errors.noClient"));

  const { error } = await supabase
    .from("client_discounts")
    .delete()
    .eq("workspace_id", resolved)
    .eq("client_id", client)
    .eq("target", target);
  if (error) throw writeError(error);
}
