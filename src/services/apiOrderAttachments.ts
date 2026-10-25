import {
  buildOrderAttachmentStoragePath,
  ORDER_ATTACHMENT_SIGNED_URL_SECONDS,
  ORDER_ATTACHMENTS_BUCKET,
  resolveAttachmentMimeType,
  sanitizeAttachmentFileName,
  validateOrderAttachmentFile,
  type OrderAttachment,
} from "../features/orders/orderAttachments";
import i18n from "../i18n";
import supabase from "./supabase";

const attachmentErrors = {
  orderRequired: () => i18n.t("orders.attachments.errors.orderRequired"),
  empty: () => i18n.t("orders.attachments.errors.empty"),
  tooLarge: () => i18n.t("orders.attachments.errors.tooLarge"),
  unsupportedType: () => i18n.t("orders.attachments.errors.unsupportedType"),
  loadFailed: () => i18n.t("orders.attachments.errors.loadFailed"),
  uploadFailed: () => i18n.t("orders.attachments.errors.uploadFailed"),
  metadataFailed: () => i18n.t("orders.attachments.errors.metadataFailed"),
  cleanupFailed: () => i18n.t("orders.attachments.errors.cleanupFailed"),
  signedUrlFailed: () => i18n.t("orders.attachments.errors.signedUrlFailed"),
  deleteFailed: () => i18n.t("orders.attachments.errors.deleteFailed"),
  notFound: () => i18n.t("orders.attachments.errors.notFound"),
} as const;

function errorMessage(error: { message?: string } | null | undefined, fallback: string) {
  const message = error?.message?.trim();
  return message || fallback;
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function requireOrderId(orderId: string | undefined) {
  const id = orderId?.trim() ?? "";
  if (!id) throw new Error(attachmentErrors.orderRequired());
  return id;
}

export function toOrderAttachment(row: Record<string, unknown>): OrderAttachment | null {
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.workspace_id !== "string" || !row.workspace_id) return null;
  if (typeof row.order_id !== "string" || !row.order_id) return null;
  if (typeof row.storage_path !== "string" || !row.storage_path) return null;
  const fileName = typeof row.file_name === "string" ? row.file_name : "";
  const mimeType = typeof row.mime_type === "string" ? row.mime_type : "application/octet-stream";
  const fileSize = Number(row.file_size ?? 0);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    orderId: row.order_id,
    uploadedBy: typeof row.uploaded_by === "string" ? row.uploaded_by : null,
    fileName,
    storagePath: row.storage_path,
    mimeType,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Metadata for one order, scoped to the active workspace. */
export async function listOrderAttachments(workspaceId: string | undefined, orderId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);

  const { data, error } = await supabase
    .from("order_attachments")
    .select("id, workspace_id, order_id, uploaded_by, file_name, storage_path, mime_type, file_size, created_at")
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", targetOrderId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(errorMessage(error, attachmentErrors.loadFailed()));

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => toOrderAttachment(row))
    .filter((row): row is OrderAttachment => row != null);
}

export async function createOrderAttachmentSignedUrl(storagePath: string, expiresIn = ORDER_ATTACHMENT_SIGNED_URL_SECONDS) {
  const path = storagePath.trim();
  if (!path) throw new Error(attachmentErrors.signedUrlFailed());

  const { data, error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(errorMessage(error, attachmentErrors.signedUrlFailed()));
  }
  return data.signedUrl;
}

async function removeStorageObject(path: string) {
  const { error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).remove([path]);
  if (error) throw new Error(errorMessage(error, attachmentErrors.cleanupFailed()));
}

/**
 * Upload to private Storage, then insert metadata. If metadata insert fails,
 * attempt to remove the uploaded object (orphan cleanup).
 */
export async function uploadOrderAttachment(
  workspaceId: string | undefined,
  orderId: string | undefined,
  file: File,
) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);

  const validation = validateOrderAttachmentFile(file);
  if (validation === "empty") throw new Error(attachmentErrors.empty());
  if (validation === "tooLarge") throw new Error(attachmentErrors.tooLarge());
  if (validation === "unsupportedType") throw new Error(attachmentErrors.unsupportedType());

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw new Error(errorMessage(userError, i18n.t("auth.errors.sessionExpired")));
  if (!user) throw new Error(i18n.t("auth.errors.sessionExpired"));

  const mimeType = resolveAttachmentMimeType(file);
  const fileName = sanitizeAttachmentFileName(file.name);
  const storagePath = buildOrderAttachmentStoragePath(targetWorkspaceId, targetOrderId, fileName);

  const { error: uploadError } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: mimeType,
    cacheControl: "3600",
  });
  if (uploadError) throw new Error(errorMessage(uploadError, attachmentErrors.uploadFailed()));

  const { data, error: insertError } = await supabase
    .from("order_attachments")
    .insert({
      workspace_id: targetWorkspaceId,
      order_id: targetOrderId,
      uploaded_by: user.id,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: file.size,
    })
    .select("id, workspace_id, order_id, uploaded_by, file_name, storage_path, mime_type, file_size, created_at")
    .maybeSingle();

  if (insertError || !data) {
    let cleanupError: string | null = null;
    try {
      await removeStorageObject(storagePath);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : attachmentErrors.cleanupFailed();
    }
    if (cleanupError) {
      throw new Error(
        i18n.t("orders.attachments.errors.metadataFailedOrphan", {
          detail: errorMessage(insertError, attachmentErrors.uploadFailed()),
          cleanup: cleanupError,
        }),
      );
    }
    throw new Error(errorMessage(insertError, attachmentErrors.metadataFailed()));
  }

  const attachment = toOrderAttachment(data as Record<string, unknown>);
  if (!attachment) throw new Error(attachmentErrors.metadataFailed());
  return attachment;
}

/**
 * Delete Storage object then metadata. Confirms the row belongs to the
 * workspace + order before mutating. Partial failures are reported honestly.
 */
export async function deleteOrderAttachment(
  workspaceId: string | undefined,
  orderId: string | undefined,
  attachmentId: string,
) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);
  const id = attachmentId.trim();
  if (!id) throw new Error(attachmentErrors.notFound());

  const { data: existing, error: loadError } = await supabase
    .from("order_attachments")
    .select("id, workspace_id, order_id, storage_path")
    .eq("id", id)
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", targetOrderId)
    .maybeSingle();

  if (loadError) throw new Error(errorMessage(loadError, attachmentErrors.deleteFailed()));
  if (!existing || typeof (existing as { storage_path?: unknown }).storage_path !== "string") {
    throw new Error(attachmentErrors.notFound());
  }

  const storagePath = (existing as { storage_path: string }).storage_path;

  const { error: storageError } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (storageError) throw new Error(errorMessage(storageError, attachmentErrors.deleteFailed()));

  const { data: deleted, error: deleteError } = await supabase
    .from("order_attachments")
    .delete()
    .eq("id", id)
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", targetOrderId)
    .select("id");

  if (deleteError) {
    throw new Error(
      i18n.t("orders.attachments.errors.deleteMetadataFailed", {
        detail: errorMessage(deleteError, attachmentErrors.deleteFailed()),
      }),
    );
  }
  if (!deleted || deleted.length === 0) {
    throw new Error(
      i18n.t("orders.attachments.errors.deleteMetadataFailed", { detail: attachmentErrors.notFound() }),
    );
  }
}
