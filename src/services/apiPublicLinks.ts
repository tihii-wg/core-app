import i18n from "../i18n";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

/**
 * Public order status by token (docs/ro-app-migration.md §6 "Публичные страницы").
 *
 * `public_links` has no anon RLS policy on purpose, so the browser never selects from it. It calls the
 * SECURITY DEFINER RPC `crm_public_order_status(p_token)` instead (supabase/manual/20261101090000_public_order_status_rpc.PRODUCTION.sql),
 * which validates the token (order link, not revoked, not expired) and returns ONLY the whitelisted fields below.
 * No auth bypass: without a valid token the RPC returns NULL. READ-ONLY.
 *
 * Creating links goes through `crm_create_public_order_link` (20261101110000_…): the token is returned once
 * from that RPC. Column SELECT(token) is revoked from authenticated so ordinary table reads cannot leak tokens.
 */

export const CREATE_PUBLIC_ORDER_LINK_RPC = "crm_create_public_order_link";

export type PublicOrderStatus = {
  number: string | null;
  /** System status text (`new`, `in-progress`, ...). */
  status: string | null;
  /** Custom status (status_definitions) when the order uses one. */
  statusName: string | null;
  statusColor: string | null;
  serviceType: string | null;
  deadline: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PublicOrderLookup =
  | { kind: "ok"; order: PublicOrderStatus }
  /** Unknown, revoked, expired or malformed token (the server does not say which). */
  | { kind: "notFound" }
  /** The RPC / `public_links` table is not applied in this database. */
  | { kind: "unavailable" };

/** public_links.token is two UUIDs without dashes (64 hex chars); accept any plausible alphanumeric token. */
export function isPlausiblePublicToken(token: string | undefined | null): token is string {
  return typeof token === "string" && /^[A-Za-z0-9]{20,128}$/.test(token);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Reads the RPC payload through an explicit whitelist, so even if the SQL were widened later
 * private fields (client, prices, comments, notes) can never reach the page.
 */
export function parsePublicOrderStatus(raw: unknown): PublicOrderStatus | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.entity_type !== "order") return null;
  return {
    number: text(row.number),
    status: text(row.status),
    statusName: text(row.status_name),
    statusColor: text(row.status_color),
    serviceType: text(row.service_type),
    deadline: text(row.deadline),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

type RpcError = { code?: string; message?: string } | null;

/** PGRST202 (function not in schema cache) / 42883 (undefined_function) / missing relation. */
function isUnavailableError(error: RpcError) {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || isMissingTableError(error, "public_links") || /crm_public_order_status/.test(error.message ?? "");
}

export async function getPublicOrderStatus(token: string | undefined): Promise<PublicOrderLookup> {
  if (!isPlausiblePublicToken(token)) return { kind: "notFound" };
  const { data, error } = await supabase.rpc("crm_public_order_status", { p_token: token });
  if (error) {
    if (isUnavailableError(error)) return { kind: "unavailable" };
    throw new Error(error.message);
  }
  const order = parsePublicOrderStatus(data);
  return order ? { kind: "ok", order } : { kind: "notFound" };
}

export type CreatedPublicOrderLink = {
  id: string;
  token: string;
  expiresAt: string | null;
  createdAt: string | null;
};

/** Absolute public status URL for the current origin + locale. */
export function publicOrderStatusUrl(token: string, locale: string) {
  const path = `/${locale}/public/${token}`;
  if (typeof window === "undefined" || !window.location?.origin) return path;
  return `${window.location.origin}${path}`;
}

/**
 * Mints a new public_links row for the order via SECURITY DEFINER RPC and returns the token once.
 * Throws `MissingRpcError` when the create SQL is not applied.
 */
export async function createPublicOrderLink(orderId: string, expiresAt?: string | null): Promise<CreatedPublicOrderLink> {
  if (!orderId.trim()) throw new Error(i18n.t("orders.actions.publicLinkFailed"));
  const { data, error } = await supabase.rpc(CREATE_PUBLIC_ORDER_LINK_RPC, {
    p_order_id: orderId,
    p_expires_at: expiresAt ?? null,
  });
  if (error) {
    if (isMissingRpcError(error, CREATE_PUBLIC_ORDER_LINK_RPC) || isMissingTableError(error, "public_links")) {
      throw new MissingRpcError(CREATE_PUBLIC_ORDER_LINK_RPC, i18n.t("orders.actions.publicLinkUnavailable"));
    }
    throw new Error(error.message || i18n.t("orders.actions.publicLinkFailed"));
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(i18n.t("orders.actions.publicLinkFailed"));
  }
  const row = data as Record<string, unknown>;
  const token = typeof row.token === "string" ? row.token : "";
  if (!isPlausiblePublicToken(token)) throw new Error(i18n.t("orders.actions.publicLinkFailed"));
  return {
    id: String(row.id ?? ""),
    token,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}
