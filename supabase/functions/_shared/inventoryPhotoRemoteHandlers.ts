import { corsHeaders, errorResponse, jsonResponse } from "./cors.ts";
import { sanitizeAttachmentFileName } from "./orderAttachmentDriveHelpers.ts";
import {
  createRemoteAdapter,
  isRemoteReconnectError,
  reconnectErrorCode,
  type AttachmentRemoteRow,
  type RemoteProvider,
} from "./remoteAttachmentAdapters.ts";
import { bearerToken, serviceClient, userClient } from "./supabase.ts";

/**
 * Inventory item photos on the workspace's chosen storage (Google Drive / NAS), next to the order files:
 * one «Product photos» folder under the workspace root. The app keeps only the small list thumbnail in its own
 * storage; `inventory_items.photo_path` holds "<provider>:<ref>|<thumbnail path>".
 */

const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const FOLDER_LABELS: Record<string, string> = {
  ru: "Фото товаров",
  ro: "Fotografii produse",
  en: "Product photos",
};

// deno-lint-ignore no-explicit-any
async function requireMember(req: Request, workspaceId: string, appUrl: string): Promise<Response | { user: any; userId: string }> {
  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);
  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);
  const { data: member } = await user
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member) return errorResponse("forbidden", "Not a workspace member", 403, appUrl);
  return { user, userId: userData.user.id };
}

// deno-lint-ignore no-explicit-any
async function workspaceStorage(admin: any, workspaceId: string) {
  const { data } = await admin.from("workspaces").select("attachment_storage, language").eq("id", workspaceId).maybeSingle();
  const mode = data?.attachment_storage === "google_drive" || data?.attachment_storage === "nas" ? (data.attachment_storage as RemoteProvider) : null;
  const language = typeof data?.language === "string" ? data.language.slice(0, 2).toLowerCase() : "en";
  return { mode, folderLabel: FOLDER_LABELS[language] ?? FOLDER_LABELS.en };
}

function remoteRow(workspaceId: string, provider: RemoteProvider, ref: string): AttachmentRemoteRow {
  return {
    id: "",
    workspace_id: workspaceId,
    order_id: "",
    storage_provider: provider,
    drive_file_id: provider === "google_drive" ? ref : null,
    nas_path: provider === "nas" ? ref : null,
  };
}

function parseProvider(value: unknown): RemoteProvider | null {
  return value === "google_drive" || value === "nas" ? value : null;
}

function reconnect(error: unknown, appUrl: string) {
  return errorResponse(reconnectErrorCode(error), "Remote storage authorization expired", 409, appUrl);
}

/** POST form {workspaceId, itemId, file} → {provider, ref}. The app writes photo_path itself (RLS applies there). */
export async function handleInventoryPhotoUpload(req: Request, appUrl: string): Promise<Response> {
  const form = await req.formData();
  const workspaceId = String(form.get("workspaceId") ?? "").trim();
  const itemId = String(form.get("itemId") ?? "").trim();
  const file = form.get("file");
  if (!workspaceId || !itemId || !(file instanceof File)) {
    return errorResponse("invalid_args", "workspaceId, itemId and file are required", 400, appUrl);
  }
  const auth = await requireMember(req, workspaceId, appUrl);
  if (auth instanceof Response) return auth;

  const { data: item } = await auth.user.from("inventory_items").select("id").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle();
  if (!item) return errorResponse("not_found", "Item not found", 404, appUrl);

  const mimeType = (file.type || "").toLowerCase();
  if (!/^image\/(webp|jpeg|png)$/.test(mimeType)) return errorResponse("unsupported_type", "Unsupported file type", 400, appUrl);
  if (file.size <= 0) return errorResponse("empty", "Empty file", 400, appUrl);
  if (file.size > PHOTO_MAX_BYTES) return errorResponse("too_large", "File too large", 400, appUrl);

  const admin = serviceClient();
  const { mode, folderLabel } = await workspaceStorage(admin, workspaceId);
  if (!mode) return errorResponse("storage_mode", "Workspace is not using remote storage", 409, appUrl);

  try {
    const adapter = await createRemoteAdapter(admin, workspaceId, mode);
    const folderRef = await adapter.ensureNamedFolder(folderLabel);
    const uploaded = await adapter.upload(folderRef, sanitizeAttachmentFileName(file.name || "photo.webp"), new Uint8Array(await file.arrayBuffer()), mimeType);
    const ref = mode === "google_drive" ? uploaded.driveFileId : uploaded.nasPath;
    if (!ref) return errorResponse("provider_error", "Remote storage returned no file reference", 500, appUrl);
    return jsonResponse({ provider: mode, ref }, 200, appUrl);
  } catch (error) {
    if (isRemoteReconnectError(error)) return reconnect(error, appUrl);
    throw error;
  }
}

/** GET ?workspaceId&provider&ref → photo bytes. Only refs that an item of the workspace points to are served. */
export async function handleInventoryPhotoContent(req: Request, url: URL, appUrl: string): Promise<Response> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const provider = parseProvider(url.searchParams.get("provider"));
  const ref = url.searchParams.get("ref")?.trim() ?? "";
  if (!workspaceId || !provider || !ref) return errorResponse("invalid_args", "workspaceId, provider and ref required", 400, appUrl);
  const auth = await requireMember(req, workspaceId, appUrl);
  if (auth instanceof Response) return auth;

  const prefix = `${provider}:${ref}|`;
  const { data: rows } = await auth.user
    .from("inventory_items")
    .select("photo_path")
    .eq("workspace_id", workspaceId)
    .like("photo_path", `${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    .limit(1);
  const linked = (rows ?? []).some((row: { photo_path?: string | null }) => typeof row.photo_path === "string" && row.photo_path.startsWith(prefix));
  if (!linked) return errorResponse("not_found", "Photo not found", 404, appUrl);

  try {
    const admin = serviceClient();
    const adapter = await createRemoteAdapter(admin, workspaceId, provider);
    const downloaded = await adapter.download(remoteRow(workspaceId, provider, ref), "full");
    return new Response(downloaded.bytes, {
      status: 200,
      headers: {
        ...corsHeaders(appUrl),
        "Content-Type": downloaded.contentType || "image/webp",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (isRemoteReconnectError(error)) return reconnect(error, appUrl);
    throw error;
  }
}

/** POST {workspaceId, provider, ref}: removes a replaced / deleted photo — only inside the product photos folder. */
export async function handleInventoryPhotoDelete(req: Request, appUrl: string): Promise<Response> {
  const body = (await req.json()) as { workspaceId?: string; provider?: string; ref?: string };
  const workspaceId = body.workspaceId?.trim() ?? "";
  const provider = parseProvider(body.provider);
  const ref = body.ref?.trim() ?? "";
  if (!workspaceId || !provider || !ref) return errorResponse("invalid_args", "workspaceId, provider and ref required", 400, appUrl);
  const auth = await requireMember(req, workspaceId, appUrl);
  if (auth instanceof Response) return auth;

  const admin = serviceClient();
  const { folderLabel } = await workspaceStorage(admin, workspaceId);
  try {
    const adapter = await createRemoteAdapter(admin, workspaceId, provider);
    const folderRef = await adapter.ensureNamedFolder(folderLabel);
    const row = remoteRow(workspaceId, provider, ref);
    if (!(await adapter.isInFolder(row, folderRef))) return errorResponse("forbidden", "Not a product photo", 403, appUrl);
    await adapter.remove(row);
    return jsonResponse({ ok: true }, 200, appUrl);
  } catch (error) {
    if (isRemoteReconnectError(error)) return reconnect(error, appUrl);
    throw error;
  }
}
