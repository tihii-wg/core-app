import { orderDriveFolderName, sanitizeDriveItemName } from "./googleDrive.ts";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function isImageMimeType(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function maxBytesForMime(mimeType: string) {
  return isImageMimeType(mimeType) ? PHOTO_MAX_BYTES : DOCUMENT_MAX_BYTES;
}

export type AttachmentSizeError = "empty" | "unsupportedType" | "tooLarge";

export function validateDriveUploadFile(opts: {
  mimeType: string;
  size: number;
}): AttachmentSizeError | null {
  if (!opts.size || opts.size <= 0) return "empty";
  const mime = opts.mimeType === "image/jpg" ? "image/jpeg" : opts.mimeType.toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) return "unsupportedType";
  if (opts.size > maxBytesForMime(mime)) return "tooLarge";
  return null;
}

/**
 * Mirror assertClosedOrderMutableOnServer:
 * open → ok; cancelled → owner only; closed (non-cancelled) → immutable.
 */
export function assertOrderMutableForAttachments(opts: {
  status: string;
  closedAt: string | null;
  isOwner: boolean;
}): "ok" | "closed_immutable" | "cancelled_owner_only" {
  const closed = Boolean(opts.closedAt) || opts.status === "closed";
  if (!closed) return "ok";
  if (opts.status === "cancelled") {
    return opts.isOwner ? "ok" : "cancelled_owner_only";
  }
  return "closed_immutable";
}

export function buildOrderFolderLabel(orderNumber: string, clientName: string) {
  return orderDriveFolderName(orderNumber, clientName);
}

export function sanitizeAttachmentFileName(fileName: string) {
  return sanitizeDriveItemName(fileName.replace(/[\\/]+/g, "-"), "file");
}

export type DriveConnectionRow = {
  status: string | null;
  root_folder_id: string | null;
  google_account_email?: string | null;
};

export function assertDriveConnectionReady(row: DriveConnectionRow | null): "ok" | "not_connected" | "error" {
  if (!row || row.status !== "connected" || !row.root_folder_id) {
    if (row?.status === "error") return "error";
    return "not_connected";
  }
  return "ok";
}
