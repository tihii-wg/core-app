import i18n from "../i18n";
import { resolveActorName } from "./apiActivityLog";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/**
 * Order comments (`order_comments`, crm_ro_v1). RLS: view '*', insert/update/delete `orders.edit`.
 * Deleting is a soft delete (`deleted_at`) so the table keeps an audit trail.
 */

export type OrderComment = {
  id: string;
  orderId: string;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  isPublic: boolean;
  createdAt: string;
};

export type OrderCommentsResult = {
  comments: OrderComment[];
  /** True when `order_comments` is not applied in this database yet (crm_ro_v1.PRODUCTION.sql). */
  isUnavailable: boolean;
};

const commentColumns = "id, order_id, author_user_id, author_name, body, is_public, created_at";
export const ORDER_COMMENTS_LIMIT = 200;
export const ORDER_COMMENT_MAX_LENGTH = 4000;

export function toOrderComment(row: Record<string, unknown>): OrderComment {
  const author = typeof row.author_name === "string" ? row.author_name.trim() : "";
  return {
    id: String(row.id),
    orderId: typeof row.order_id === "string" ? row.order_id : "",
    authorUserId: typeof row.author_user_id === "string" ? row.author_user_id : null,
    authorName: author || null,
    body: typeof row.body === "string" ? row.body : "",
    isPublic: row.is_public === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Trims and validates a comment body; throws a user-facing error when empty or too long. Pure. */
export function normalizeCommentBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error(i18n.t("orders.feed.errors.commentRequired"));
  if (trimmed.length > ORDER_COMMENT_MAX_LENGTH) {
    throw new Error(i18n.t("orders.feed.errors.commentTooLong", { max: ORDER_COMMENT_MAX_LENGTH }));
  }
  return trimmed;
}

type DbError = { code?: string; message?: string };

function writeError(error: DbError) {
  if (isMissingTableError(error, "order_comments")) return new Error(i18n.t("orders.feed.errors.unavailable"));
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")) {
    return new Error(i18n.t("orders.feed.errors.permission"));
  }
  return new Error(error.message || i18n.t("orders.feed.errors.writeFailed"));
}

/** Newest first. */
export async function getOrderComments(workspaceId: string | undefined, orderId: string): Promise<OrderCommentsResult> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!orderId.trim()) return { comments: [], isUnavailable: false };

  const { data, error } = await supabase
    .from("order_comments")
    .select(commentColumns)
    .eq("workspace_id", resolved)
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(ORDER_COMMENTS_LIMIT);

  if (error) {
    if (isMissingTableError(error, "order_comments")) return { comments: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { comments: ((data ?? []) as Record<string, unknown>[]).map(toOrderComment), isUnavailable: false };
}

export async function createOrderComment(workspaceId: string | undefined, orderId: string, body: string): Promise<OrderComment> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!orderId.trim()) throw new Error(i18n.t("orders.feed.errors.noOrder"));
  const { assertClosedOrderMutableOnServer } = await import("./apiOrders");
  await assertClosedOrderMutableOnServer(orderId, resolved);
  const text = normalizeCommentBody(body);

  let authorName: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    authorName = resolveActorName(null, data?.user);
  } catch {
    authorName = null;
  }

  // author_user_id defaults to auth.uid() in the table definition.
  const { data, error } = await supabase
    .from("order_comments")
    .insert({ workspace_id: resolved, order_id: orderId, body: text, author_name: authorName, is_public: false })
    .select(commentColumns)
    .single();

  if (error) throw writeError(error);
  return toOrderComment(data as Record<string, unknown>);
}

export async function deleteOrderComment(workspaceId: string | undefined, orderId: string, commentId: string): Promise<void> {
  const resolved = requireWorkspaceId(workspaceId);
  const { assertClosedOrderMutableOnServer } = await import("./apiOrders");
  await assertClosedOrderMutableOnServer(orderId, resolved);
  const { data, error } = await supabase
    .from("order_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", resolved)
    .eq("order_id", orderId)
    .eq("id", commentId)
    .is("deleted_at", null)
    .select("id");

  if (error) throw writeError(error);
  // RLS filters rows silently: no returned row means the caller may not edit it (or it is already gone).
  if (!data || data.length === 0) throw new Error(i18n.t("orders.feed.errors.permission"));
}
