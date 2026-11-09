import { corsHeaders, errorResponse, jsonResponse } from "./cors.ts";
import {
  assertOrderMutableForAttachments,
  sanitizeAttachmentFileName,
  validateDriveUploadFile,
} from "./orderAttachmentDriveHelpers.ts";
import {
  createRemoteAdapter,
  isRemoteReconnectError,
  reconnectErrorCode,
  type RemoteProvider,
} from "./remoteAttachmentAdapters.ts";
import { bearerToken, serviceClient, userClient } from "./supabase.ts";

const ATTACHMENT_SELECT =
  "id, workspace_id, order_id, uploaded_by, file_name, storage_path, storage_provider, drive_file_id, drive_folder_id, nas_path, mime_type, file_size, created_at";

async function requireMember(req: Request, workspaceId: string, appUrl: string) {
  const jwt = bearerToken(req);
  if (!jwt) return { error: errorResponse("unauthorized", "Missing bearer token", 401, appUrl) } as const;
  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) {
    return { error: errorResponse("unauthorized", "Invalid session", 401, appUrl) } as const;
  }
  const { data: member } = await user
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member) {
    return { error: errorResponse("forbidden", "Not a workspace member", 403, appUrl) } as const;
  }
  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  return { jwt, user, userId: userData.user.id, isOwner: isOwner === true } as const;
}

function clientNameFromOrder(order: { clients?: unknown }): string {
  const clientJoin = order.clients;
  if (Array.isArray(clientJoin)) {
    return String((clientJoin[0] as { name?: string } | undefined)?.name ?? "");
  }
  return String((clientJoin as { name?: string } | null)?.name ?? "");
}

export async function handleRemoteUpload(req: Request, appUrl: string): Promise<Response> {
  const form = await req.formData();
  const workspaceId = String(form.get("workspaceId") ?? "").trim();
  const orderId = String(form.get("orderId") ?? "").trim();
  const file = form.get("file");
  if (!workspaceId || !orderId || !(file instanceof File)) {
    return errorResponse("invalid_args", "workspaceId, orderId and file are required", 400, appUrl);
  }

  const auth = await requireMember(req, workspaceId, appUrl);
  if ("error" in auth) return auth.error;

  const admin = serviceClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, workspace_id, status, closed_at, number, clients!orders_client_id_fkey(name)")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (orderError || !order) return errorResponse("not_found", "Order not found", 404, appUrl);

  const mutability = assertOrderMutableForAttachments({
    status: typeof order.status === "string" ? order.status : "",
    closedAt: typeof order.closed_at === "string" ? order.closed_at : null,
    isOwner: auth.isOwner,
  });
  if (mutability !== "ok") {
    return errorResponse(
      "order_lifecycle:closed_order_immutable",
      "Closed order attachments cannot be changed",
      409,
      appUrl,
    );
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("attachment_storage")
    .eq("id", workspaceId)
    .maybeSingle();
  const mode = workspace?.attachment_storage;
  if (mode !== "google_drive" && mode !== "nas") {
    return errorResponse("storage_mode", "Workspace is not using remote storage", 409, appUrl);
  }
  const provider = mode as RemoteProvider;

  const mimeType = (file.type || "application/octet-stream").toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : (file.type || "application/octet-stream").toLowerCase();
  const validation = validateDriveUploadFile({ mimeType, size: file.size });
  if (validation === "empty") return errorResponse("empty", "Empty file", 400, appUrl);
  if (validation === "unsupportedType") return errorResponse("unsupported_type", "Unsupported file type", 400, appUrl);
  if (validation === "tooLarge") return errorResponse("too_large", "File too large", 400, appUrl);

  let adapter;
  try {
    adapter = await createRemoteAdapter(admin, workspaceId, provider);
  } catch (error) {
    const code = reconnectErrorCode(error);
    return errorResponse(code, error instanceof Error ? error.message : "Remote storage unavailable", 409, appUrl);
  }

  const orderNumber = typeof order.number === "string" ? order.number : orderId.slice(0, 8);
  const clientName = clientNameFromOrder(order);

  let folderRef: string;
  try {
    folderRef = await adapter.ensureOrderFolder({ orderId, orderNumber, clientName });
  } catch (error) {
    if (isRemoteReconnectError(error)) {
      return errorResponse(reconnectErrorCode(error), "Remote storage authorization expired", 409, appUrl);
    }
    throw error;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = sanitizeAttachmentFileName(file.name || "file");
  let uploaded;
  try {
    uploaded = await adapter.upload(folderRef, fileName, bytes, mimeType);
  } catch (error) {
    if (isRemoteReconnectError(error)) {
      return errorResponse(reconnectErrorCode(error), "Remote storage authorization expired", 409, appUrl);
    }
    throw error;
  }

  const { data: inserted, error: insertError } = await admin
    .from("order_attachments")
    .insert({
      workspace_id: workspaceId,
      order_id: orderId,
      uploaded_by: auth.userId,
      file_name: fileName,
      storage_path: null,
      storage_provider: uploaded.storageProvider,
      drive_file_id: uploaded.driveFileId ?? null,
      drive_folder_id: uploaded.driveFolderId ?? null,
      nas_path: uploaded.nasPath ?? null,
      mime_type: mimeType,
      file_size: file.size,
    })
    .select(ATTACHMENT_SELECT)
    .maybeSingle();

  if (insertError || !inserted) {
    try {
      await adapter.remove({
        id: "",
        workspace_id: workspaceId,
        order_id: orderId,
        storage_provider: uploaded.storageProvider,
        drive_file_id: uploaded.driveFileId,
        nas_path: uploaded.nasPath,
      });
    } catch (cleanupError) {
      console.error("[order-attachment-remote] orphan cleanup", cleanupError);
    }
    return errorResponse("metadata_failed", insertError?.message || "Failed to save attachment", 500, appUrl);
  }

  return jsonResponse({ attachment: inserted }, 200, appUrl);
}

export async function handleRemoteContent(req: Request, url: URL, appUrl: string): Promise<Response> {
  const attachmentId = url.searchParams.get("attachmentId")?.trim() ?? "";
  const variant = (url.searchParams.get("variant")?.trim() || "full") as "thumb" | "full";
  if (!attachmentId) return errorResponse("invalid_args", "attachmentId required", 400, appUrl);

  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);
  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: attachment, error: loadError } = await user
    .from("order_attachments")
    .select("id, workspace_id, order_id, storage_provider, drive_file_id, drive_folder_id, nas_path, mime_type, file_name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (loadError || !attachment) return errorResponse("not_found", "Attachment not found", 404, appUrl);

  const provider = attachment.storage_provider;
  if (provider !== "google_drive" && provider !== "nas") {
    return errorResponse("invalid_args", "Not a remote attachment", 400, appUrl);
  }

  const admin = serviceClient();
  let adapter;
  try {
    adapter = await createRemoteAdapter(admin, attachment.workspace_id, provider);
  } catch (error) {
    return errorResponse(reconnectErrorCode(error), "Remote storage unavailable", 409, appUrl);
  }

  try {
    const downloaded = await adapter.download(attachment, variant);
    return new Response(downloaded.bytes, {
      status: 200,
      headers: {
        ...corsHeaders(appUrl),
        "Content-Type": downloaded.contentType || attachment.mime_type || "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (isRemoteReconnectError(error)) {
      return errorResponse(reconnectErrorCode(error), "Remote storage authorization expired", 409, appUrl);
    }
    throw error;
  }
}

export async function handleRemoteDelete(req: Request, appUrl: string): Promise<Response> {
  const body = (await req.json()) as { attachmentId?: string };
  const attachmentId = body.attachmentId?.trim() ?? "";
  if (!attachmentId) return errorResponse("invalid_args", "attachmentId required", 400, appUrl);

  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);
  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: attachment, error: loadError } = await user
    .from("order_attachments")
    .select("id, workspace_id, order_id, storage_provider, drive_file_id, drive_folder_id, nas_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (loadError || !attachment) return errorResponse("not_found", "Attachment not found", 404, appUrl);
  if (attachment.storage_provider !== "google_drive" && attachment.storage_provider !== "nas") {
    return errorResponse("invalid_args", "Not a remote attachment", 400, appUrl);
  }

  const admin = serviceClient();
  const { data: order } = await admin
    .from("orders")
    .select("status, closed_at")
    .eq("id", attachment.order_id)
    .eq("workspace_id", attachment.workspace_id)
    .maybeSingle();
  if (!order) return errorResponse("not_found", "Order not found", 404, appUrl);

  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", {
    p_workspace_id: attachment.workspace_id,
  });
  const mutability = assertOrderMutableForAttachments({
    status: typeof order.status === "string" ? order.status : "",
    closedAt: typeof order.closed_at === "string" ? order.closed_at : null,
    isOwner: isOwner === true,
  });
  if (mutability !== "ok") {
    return errorResponse(
      "order_lifecycle:closed_order_immutable",
      "Closed order attachments cannot be changed",
      409,
      appUrl,
    );
  }

  try {
    const adapter = await createRemoteAdapter(
      admin,
      attachment.workspace_id,
      attachment.storage_provider as RemoteProvider,
    );
    await adapter.remove(attachment);
  } catch (error) {
    console.error("[order-attachment-remote] remove", error);
    // Best effort — still delete metadata.
  }

  const soft = await admin
    .from("order_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachmentId)
    .eq("workspace_id", attachment.workspace_id)
    .select("id");
  if (soft.error && /deleted_at|PGRST204|42703/i.test(soft.error.message ?? "")) {
    const { error: hardError } = await admin
      .from("order_attachments")
      .delete()
      .eq("id", attachmentId)
      .eq("workspace_id", attachment.workspace_id);
    if (hardError) return errorResponse("delete_failed", hardError.message, 500, appUrl);
  } else if (soft.error) {
    return errorResponse("delete_failed", soft.error.message, 500, appUrl);
  }

  return jsonResponse({ ok: true }, 200, appUrl);
}

export async function handleRemoteTrashOrderFolder(req: Request, appUrl: string): Promise<Response> {
  const body = (await req.json()) as { orderId?: string; workspaceId?: string };
  const orderId = body.orderId?.trim() ?? "";
  const workspaceId = body.workspaceId?.trim() ?? "";
  if (!orderId || !workspaceId) {
    return errorResponse("invalid_args", "orderId and workspaceId required", 400, appUrl);
  }

  const auth = await requireMember(req, workspaceId, appUrl);
  if ("error" in auth) return auth.error;

  const admin = serviceClient();
  // Only for orders that are already deleted: never trash the folder of a live order.
  const { data: stillExists } = await admin
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (stillExists) {
    return errorResponse("order_exists", "Order still exists; folders are trashed only after deletion", 409, appUrl);
  }
  // Try both providers best-effort (order may have mixed leftover folders).
  for (const provider of ["google_drive", "nas"] as const) {
    try {
      const adapter = await createRemoteAdapter(admin, workspaceId, provider);
      await adapter.trashOrderFolder(orderId);
    } catch (error) {
      console.error(`[order-attachment-remote] trash-order-folder ${provider}`, error);
    }
  }

  return jsonResponse({ ok: true, trashed: true }, 200, appUrl);
}

export async function routeRemoteAttachment(req: Request): Promise<Response> {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    if (path.endsWith("/upload") && req.method === "POST") {
      return await handleRemoteUpload(req, appUrl);
    }
    if (path.endsWith("/content") && req.method === "GET") {
      return await handleRemoteContent(req, url, appUrl);
    }
    if (path.endsWith("/delete") && req.method === "POST") {
      return await handleRemoteDelete(req, appUrl);
    }
    if (path.endsWith("/trash-order-folder") && req.method === "POST") {
      return await handleRemoteTrashOrderFolder(req, appUrl);
    }
    return errorResponse("not_found", "Unknown route", 404, appUrl);
  } catch (error) {
    console.error("[order-attachment-remote]", error instanceof Error ? error.message : error);
    if (isRemoteReconnectError(error)) {
      return errorResponse(reconnectErrorCode(error), "Remote storage authorization expired", 409, appUrl);
    }
    return errorResponse("provider_error", error instanceof Error ? error.message : "Remote request failed", 500, appUrl);
  }
}
