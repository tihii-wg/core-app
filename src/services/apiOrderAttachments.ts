import {
  buildOrderAttachmentStoragePath,
  isRemoteAttachment,
  isImageMimeType,
  ORDER_ATTACHMENT_PHOTO_MAX_BYTES,
  ORDER_ATTACHMENT_SIGNED_URL_SECONDS,
  ORDER_ATTACHMENTS_BUCKET,
  resolveAttachmentMimeType,
  sanitizeAttachmentFileName,
  validateOrderAttachmentFile,
  type OrderAttachment,
  type OrderAttachmentStorageProvider,
} from "../features/orders/orderAttachments";
import i18n from "../i18n";
import supabase from "./supabase";

const ATTACHMENT_SELECT =
  "id, workspace_id, order_id, uploaded_by, file_name, storage_path, storage_provider, drive_file_id, drive_folder_id, nas_path, mime_type, file_size, created_at";

const REMOTE_FUNCTION = "order-attachment-remote";

const attachmentErrors = {
  orderRequired: () => i18n.t("orders.attachments.errors.orderRequired"),
  empty: () => i18n.t("orders.attachments.errors.empty"),
  tooLarge: () => i18n.t("orders.attachments.errors.tooLarge"),
  photoTooLarge: () => i18n.t("orders.attachments.errors.photoTooLarge"),
  unsupportedType: () => i18n.t("orders.attachments.errors.unsupportedType"),
  loadFailed: () => i18n.t("orders.attachments.errors.loadFailed"),
  uploadFailed: () => i18n.t("orders.attachments.errors.uploadFailed"),
  metadataFailed: () => i18n.t("orders.attachments.errors.metadataFailed"),
  cleanupFailed: () => i18n.t("orders.attachments.errors.cleanupFailed"),
  signedUrlFailed: () => i18n.t("orders.attachments.errors.signedUrlFailed"),
  deleteFailed: () => i18n.t("orders.attachments.errors.deleteFailed"),
  notFound: () => i18n.t("orders.attachments.errors.notFound"),
} as const;

export type UploadOrderAttachmentResult = {
  attachment: OrderAttachment;
  /** Preferred remote provider that failed (Drive/NAS) when the file was saved to app storage instead. */
  fallbackFrom?: "google_drive" | "nas";
};

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

  const provider: OrderAttachmentStorageProvider =
    row.storage_provider === "google_drive"
      ? "google_drive"
      : row.storage_provider === "nas"
        ? "nas"
        : "app";
  const storagePath = typeof row.storage_path === "string" && row.storage_path ? row.storage_path : null;
  const driveFileId = typeof row.drive_file_id === "string" && row.drive_file_id ? row.drive_file_id : null;
  const driveFolderId = typeof row.drive_folder_id === "string" && row.drive_folder_id ? row.drive_folder_id : null;
  const nasPath = typeof row.nas_path === "string" && row.nas_path ? row.nas_path : null;

  if (provider === "app" && !storagePath) return null;
  if (provider === "google_drive" && !driveFileId) return null;
  if (provider === "nas" && !nasPath) return null;

  const fileName = typeof row.file_name === "string" ? row.file_name : "";
  const mimeType = typeof row.mime_type === "string" ? row.mime_type : "application/octet-stream";
  const fileSize = Number(row.file_size ?? 0);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    orderId: row.order_id,
    uploadedBy: typeof row.uploaded_by === "string" ? row.uploaded_by : null,
    fileName,
    storagePath,
    storageProvider: provider,
    driveFileId,
    driveFolderId,
    nasPath,
    mimeType,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Metadata for one order, scoped to the active workspace. */
export async function listOrderAttachments(workspaceId: string | undefined, orderId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);

  const selectLegacy =
    "id, workspace_id, order_id, uploaded_by, file_name, storage_path, storage_provider, drive_file_id, drive_folder_id, mime_type, file_size, created_at";

  let result = await supabase
    .from("order_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", targetOrderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (result.error && /nas_path|deleted_at|PGRST204|42703/i.test(result.error.message ?? "")) {
    result = (await supabase
      .from("order_attachments")
      .select(selectLegacy)
      .eq("workspace_id", targetWorkspaceId)
      .eq("order_id", targetOrderId)
      .order("created_at", { ascending: false })) as unknown as typeof result;
  }
  const { data, error } = result;

  if (error) throw new Error(errorMessage(error, attachmentErrors.loadFailed()));

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => toOrderAttachment(row))
    .filter((row): row is OrderAttachment => row != null);
}

const ATTACHMENT_ORDER_CHUNK = 100;

/**
 * Metadata for many orders at once (client card «Файлы заказов»). Same rows/select and
 * legacy-column fallback as `listOrderAttachments`, but one `IN (...)` query per chunk of 100 order ids
 * instead of one request per order.
 */
export async function listOrderAttachmentsForOrders(workspaceId: string | undefined, orderIds: string[]) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const selectLegacy =
    "id, workspace_id, order_id, uploaded_by, file_name, storage_path, storage_provider, drive_file_id, drive_folder_id, mime_type, file_size, created_at";

  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += ATTACHMENT_ORDER_CHUNK) {
    const chunk = ids.slice(index, index + ATTACHMENT_ORDER_CHUNK);
    let result = await supabase
      .from("order_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("workspace_id", targetWorkspaceId)
      .in("order_id", chunk)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (result.error && /nas_path|deleted_at|PGRST204|42703/i.test(result.error.message ?? "")) {
      result = (await supabase
        .from("order_attachments")
        .select(selectLegacy)
        .eq("workspace_id", targetWorkspaceId)
        .in("order_id", chunk)
        .order("created_at", { ascending: false })) as unknown as typeof result;
    }
    if (result.error) throw new Error(errorMessage(result.error, attachmentErrors.loadFailed()));
    rows.push(...((result.data ?? []) as Record<string, unknown>[]));
  }

  return rows
    .map((row) => toOrderAttachment(row))
    .filter((row): row is OrderAttachment => row != null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createOrderAttachmentSignedUrl(
  storagePath: string | null | undefined,
  expiresIn = ORDER_ATTACHMENT_SIGNED_URL_SECONDS,
) {
  const path = storagePath?.trim() ?? "";
  if (!path) throw new Error(attachmentErrors.signedUrlFailed());

  const { data, error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(errorMessage(error, attachmentErrors.signedUrlFailed()));
  }
  return data.signedUrl;
}

async function sessionAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error(i18n.t("auth.errors.sessionExpired"));
  return data.session.access_token;
}

function functionsBaseUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!base) throw new Error(attachmentErrors.uploadFailed());
  return `${base}/functions/v1`;
}

export class RemoteReconnectRequiredError extends Error {
  readonly code: "gdrive_reconnect_required" | "nas_reconnect_required";
  constructor(code: "gdrive_reconnect_required" | "nas_reconnect_required" = "gdrive_reconnect_required", message?: string) {
    super(message || code);
    this.name = "RemoteReconnectRequiredError";
    this.code = code;
  }
}

/** @deprecated use RemoteReconnectRequiredError */
export class DriveReconnectRequiredError extends RemoteReconnectRequiredError {
  constructor(message?: string) {
    super("gdrive_reconnect_required", message);
    this.name = "DriveReconnectRequiredError";
  }
}

function isRemoteFallbackWorthy(error: unknown): boolean {
  if (error instanceof RemoteReconnectRequiredError) return true;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /gdrive_reconnect_required|nas_reconnect_required|Failed to fetch|NetworkError|network/i.test(error.message);
}

type RemoteFunctionError = { code?: string; message?: string };

async function readRemoteFunctionJson(res: Response): Promise<{ attachment?: Record<string, unknown>; error?: RemoteFunctionError; ok?: boolean }> {
  try {
    return (await res.json()) as { attachment?: Record<string, unknown>; error?: RemoteFunctionError; ok?: boolean };
  } catch {
    return {};
  }
}

export async function fetchOrderAttachmentRemoteBlob(
  attachmentId: string,
  variant: "thumb" | "full" = "full",
): Promise<Blob> {
  const id = attachmentId.trim();
  if (!id) throw new Error(attachmentErrors.notFound());
  const token = await sessionAccessToken();
  const res = await fetch(
    `${functionsBaseUrl()}/${REMOTE_FUNCTION}/content?attachmentId=${encodeURIComponent(id)}&variant=${variant}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      },
    },
  );
  if (!res.ok) {
    const json = await readRemoteFunctionJson(res);
    if (json.error?.code === "nas_reconnect_required") {
      throw new RemoteReconnectRequiredError("nas_reconnect_required", json.error?.message);
    }
    if (json.error?.code === "gdrive_reconnect_required" || res.status === 409) {
      throw new RemoteReconnectRequiredError("gdrive_reconnect_required", json.error?.message);
    }
    throw new Error(json.error?.message || attachmentErrors.signedUrlFailed());
  }
  return res.blob();
}

/** @deprecated alias */
export const fetchOrderAttachmentDriveBlob = fetchOrderAttachmentRemoteBlob;

async function uploadOrderAttachmentRemote(
  workspaceId: string,
  orderId: string,
  file: File,
): Promise<OrderAttachment> {
  const token = await sessionAccessToken();
  const form = new FormData();
  form.set("workspaceId", workspaceId);
  form.set("orderId", orderId);
  form.set("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${functionsBaseUrl()}/${REMOTE_FUNCTION}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      },
      body: form,
    });
  } catch (error) {
    throw error instanceof TypeError ? error : new TypeError(error instanceof Error ? error.message : "network");
  }

  const json = await readRemoteFunctionJson(res);
  if (!res.ok || !json.attachment) {
    if (json.error?.code === "nas_reconnect_required") {
      throw new RemoteReconnectRequiredError("nas_reconnect_required", json.error?.message);
    }
    if (json.error?.code === "gdrive_reconnect_required" || res.status === 409) {
      throw new RemoteReconnectRequiredError("gdrive_reconnect_required", json.error?.message);
    }
    throw new Error(json.error?.message || attachmentErrors.uploadFailed());
  }
  const attachment = toOrderAttachment(json.attachment);
  if (!attachment) throw new Error(attachmentErrors.metadataFailed());
  return attachment;
}

async function deleteOrderAttachmentRemote(attachmentId: string): Promise<void> {
  const token = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/${REMOTE_FUNCTION}/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attachmentId }),
  });
  const json = await readRemoteFunctionJson(res);
  if (!res.ok) {
    throw new Error(json.error?.message || attachmentErrors.deleteFailed());
  }
}

/** Best-effort trash of remote order folders (Drive + NAS) after the order row is gone. */
export async function trashOrderDriveFolder(workspaceId: string, orderId: string): Promise<void> {
  try {
    const token = await sessionAccessToken();
    await fetch(`${functionsBaseUrl()}/${REMOTE_FUNCTION}/trash-order-folder`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceId, orderId }),
    });
  } catch (error) {
    console.warn("[trashOrderDriveFolder]", error);
  }
}

async function removeStorageObject(path: string) {
  const { error } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).remove([path]);
  if (error) throw new Error(errorMessage(error, attachmentErrors.cleanupFailed()));
}

async function workspaceRemoteMode(workspaceId: string): Promise<"google_drive" | "nas" | null> {
  const { data, error } = await supabase.from("workspaces").select("attachment_storage").eq("id", workspaceId).maybeSingle();
  if (error) {
    if (/attachment_storage|PGRST204|42703|does not exist/i.test(error.message ?? "")) return null;
    throw new Error(errorMessage(error, attachmentErrors.uploadFailed()));
  }
  if (data?.attachment_storage === "google_drive" || data?.attachment_storage === "nas") {
    return data.attachment_storage;
  }
  return null;
}

async function uploadOrderAttachmentToApp(
  workspaceId: string,
  orderId: string,
  file: File,
  userId: string,
  mimeType: string,
): Promise<OrderAttachment> {
  const fileName = sanitizeAttachmentFileName(file.name);
  const storagePath = buildOrderAttachmentStoragePath(workspaceId, orderId, fileName);

  const { error: uploadError } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: mimeType,
    cacheControl: "3600",
  });
  if (uploadError) throw new Error(errorMessage(uploadError, attachmentErrors.uploadFailed()));

  const { data, error: insertError } = await supabase
    .from("order_attachments")
    .insert({
      workspace_id: workspaceId,
      order_id: orderId,
      uploaded_by: userId,
      file_name: fileName,
      storage_path: storagePath,
      storage_provider: "app",
      mime_type: mimeType,
      file_size: file.size,
    })
    .select(ATTACHMENT_SELECT)
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
 * Compress photos client-side, then upload to Drive / NAS / app Storage based on
 * workspace.attachment_storage. Remote failures that need reconnect / network
 * fall back to app storage so photos are never lost.
 */
export async function uploadOrderAttachment(
  workspaceId: string | undefined,
  orderId: string | undefined,
  file: File,
): Promise<UploadOrderAttachmentResult> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);
  const { assertClosedOrderMutableOnServer } = await import("./apiOrders");
  await assertClosedOrderMutableOnServer(targetOrderId, targetWorkspaceId);

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

  let mimeType = resolveAttachmentMimeType(file);
  if (isImageMimeType(mimeType)) {
    const { compressImageToMaxBytes } = await import("../lib/compressImage");
    const result = await compressImageToMaxBytes(file, mimeType, ORDER_ATTACHMENT_PHOTO_MAX_BYTES);
    if (result.file.size > ORDER_ATTACHMENT_PHOTO_MAX_BYTES) throw new Error(attachmentErrors.photoTooLarge());
    file = result.file;
    mimeType = resolveAttachmentMimeType(file);
  }

  const remoteMode = await workspaceRemoteMode(targetWorkspaceId);
  if (remoteMode) {
    try {
      const attachment = await uploadOrderAttachmentRemote(targetWorkspaceId, targetOrderId, file);
      return { attachment };
    } catch (error) {
      if (!isRemoteFallbackWorthy(error)) throw error;
      const attachment = await uploadOrderAttachmentToApp(targetWorkspaceId, targetOrderId, file, user.id, mimeType);
      return { attachment, fallbackFrom: remoteMode };
    }
  }

  const attachment = await uploadOrderAttachmentToApp(targetWorkspaceId, targetOrderId, file, user.id, mimeType);
  return { attachment };
}

/**
 * Delete Storage object then metadata. Drive rows go through the Edge Function.
 */
export async function deleteOrderAttachment(
  workspaceId: string | undefined,
  orderId: string | undefined,
  attachmentId: string,
) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetOrderId = requireOrderId(orderId);
  const { assertClosedOrderMutableOnServer } = await import("./apiOrders");
  await assertClosedOrderMutableOnServer(targetOrderId, targetWorkspaceId);
  const id = attachmentId.trim();
  if (!id) throw new Error(attachmentErrors.notFound());

  const { data: existing, error: loadError } = await supabase
    .from("order_attachments")
    .select("id, workspace_id, order_id, storage_path, storage_provider, drive_file_id, nas_path")
    .eq("id", id)
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", targetOrderId)
    .maybeSingle();

  if (loadError) throw new Error(errorMessage(loadError, attachmentErrors.deleteFailed()));
  if (!existing) throw new Error(attachmentErrors.notFound());

  const row = existing as Record<string, unknown>;
  if (
    row.storage_provider === "google_drive" ||
    row.storage_provider === "nas" ||
    (typeof row.drive_file_id === "string" && row.drive_file_id) ||
    (typeof row.nas_path === "string" && row.nas_path)
  ) {
    await deleteOrderAttachmentRemote(id);
    return;
  }

  if (typeof row.storage_path !== "string" || !row.storage_path) {
    throw new Error(attachmentErrors.notFound());
  }

  const storagePath = row.storage_path;
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

/** Resolve a display/download URL for any attachment (app signed URL or remote blob URL). */
export async function resolveOrderAttachmentUrl(
  attachment: Pick<OrderAttachment, "id" | "storagePath" | "storageProvider" | "driveFileId" | "nasPath">,
  variant: "thumb" | "full" = "full",
): Promise<string> {
  if (isRemoteAttachment(attachment)) {
    const blob = await fetchOrderAttachmentRemoteBlob(attachment.id, variant);
    return URL.createObjectURL(blob);
  }
  return createOrderAttachmentSignedUrl(attachment.storagePath);
}
