import type { WorkspaceRole } from "../workspaces/workspaceRoles";
import { workspaceRoles } from "../workspaces/workspaceRoles";

export const ORDER_ATTACHMENTS_BUCKET = "order-attachments";
export const ORDER_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** Short-lived signed URL TTL for private bucket previews/downloads. */
export const ORDER_ATTACHMENT_SIGNED_URL_SECONDS = 60 * 15;

export type OrderAttachment = {
  id: string;
  workspaceId: string;
  orderId: string;
  uploadedBy: string | null;
  fileName: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
};

const ALLOWED_MIME_TYPES = new Set([
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

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ORDER_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,.pdf,text/plain,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function orderAttachmentsQueryKey(workspaceId: string | undefined, orderId: string | undefined) {
  return ["order-attachments", workspaceId, orderId] as const;
}

export function isImageMimeType(mimeType: string) {
  return mimeType.startsWith("image/");
}

function fileExtension(fileName: string) {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Resolve a usable MIME type from the browser value or the file extension. */
export function resolveAttachmentMimeType(file: Pick<File, "name" | "type">) {
  const raw = (file.type || "").toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  if (ALLOWED_MIME_TYPES.has(raw)) return raw;
  const ext = fileExtension(file.name);
  return EXTENSION_MIME[ext] ?? raw;
}

/**
 * Sanitize a display/storage filename: keep a short safe basename, preserve a
 * known extension when possible. Never trust the raw client name as a path.
 */
export function sanitizeAttachmentFileName(fileName: string) {
  const base = (fileName.trim().split(/[/\\]/).pop() || "file").normalize("NFKC");
  const ext = fileExtension(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  const safeStem = stem || "file";
  const safeExt = ext && EXTENSION_MIME[ext] ? ext : "";
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

export function buildOrderAttachmentStoragePath(workspaceId: string, orderId: string, fileName: string, id = crypto.randomUUID()) {
  const safeName = sanitizeAttachmentFileName(fileName);
  return `${workspaceId}/${orderId}/${id}-${safeName}`;
}

export type AttachmentValidationError = "tooLarge" | "empty" | "unsupportedType";

/** Client-side UX validation only — not a security boundary. */
export function validateOrderAttachmentFile(file: Pick<File, "name" | "type" | "size">): AttachmentValidationError | null {
  if (!file || file.size <= 0) return "empty";
  if (file.size > ORDER_ATTACHMENT_MAX_BYTES) return "tooLarge";
  const mime = resolveAttachmentMimeType(file);
  if (!ALLOWED_MIME_TYPES.has(mime)) return "unsupportedType";
  return null;
}

function isWorkspaceRole(role: string | null | undefined): role is WorkspaceRole {
  return (workspaceRoles as readonly string[]).includes(role ?? "");
}

/**
 * Application-level mutation gate for order attachments.
 *
 * There is currently no subscription entitlement column in the app schema.
 * Callers pass `hasActiveSubscription` explicitly (tests / future billing).
 * Active workspace roles may mutate when subscribed; otherwise view-only.
 *
 * Note: SQL policies currently allow any active member to delete Storage/metadata.
 * This helper does not claim DB-level role enforcement.
 */
export function canMutateOrderAttachments(
  role: string | null | undefined,
  options: { hasActiveSubscription?: boolean } = {},
) {
  if (options.hasActiveSubscription === false) return false;
  return isWorkspaceRole(role);
}

export function formatAttachmentBytes(bytes: number, locale?: string) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString(locale)} ${units[unit]}`;
}
