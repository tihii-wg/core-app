import {
  downloadDriveFile,
  downloadDriveThumbnail,
  findOrCreateFolder,
  googleAccessToken,
  isGoogleAuthError,
  trashDriveFile,
  uploadBytesToDrive,
  type GoogleCredential,
} from "./googleDrive.ts";
import {
  assertNasUrlSafe,
  joinNasPath,
  NasClientError,
  normalizeRootPath,
  parseNasCredential,
  s3DeleteObject,
  s3GetObject,
  s3PutObject,
  webdavDelete,
  webdavEnsureDir,
  webdavGet,
  webdavPut,
  type NasCredential,
} from "./nasClient.ts";
import { buildOrderFolderLabel, sanitizeAttachmentFileName } from "./orderAttachmentDriveHelpers.ts";
import { requireEnv } from "./supabase.ts";

// Deno Edge admin client (service role) — keep loosely typed to avoid circular imports.
// deno-lint-ignore no-explicit-any
type Admin = any;

export type RemoteProvider = "google_drive" | "nas";

export type UploadResult = {
  storageProvider: RemoteProvider;
  driveFileId?: string | null;
  driveFolderId?: string | null;
  nasPath?: string | null;
};

export type DownloadResult = { bytes: Uint8Array; contentType: string };

export type AttachmentRemoteRow = {
  id: string;
  workspace_id: string;
  order_id: string;
  storage_provider: string;
  drive_file_id?: string | null;
  drive_folder_id?: string | null;
  nas_path?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
};

export type OrderContext = {
  orderId: string;
  orderNumber: string;
  clientName: string;
};

export type RemoteAttachmentAdapter = {
  ensureOrderFolder: (order: OrderContext) => Promise<string>;
  upload: (
    folderRef: string,
    fileName: string,
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<UploadResult>;
  download: (attachment: AttachmentRemoteRow, variant: "thumb" | "full") => Promise<DownloadResult>;
  remove: (attachment: AttachmentRemoteRow) => Promise<void>;
  trashOrderFolder: (orderId: string) => Promise<void>;
};

async function markDriveError(admin: Admin, workspaceId: string, message: string) {
  await admin
    .from("workspace_google_drive")
    .update({
      status: "error",
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

async function markNasError(admin: Admin, workspaceId: string, message: string) {
  await admin
    .from("workspace_nas_storage")
    .update({
      status: "error",
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

export async function createDriveAdapter(admin: Admin, workspaceId: string): Promise<RemoteAttachmentAdapter> {
  const { data: connection } = await admin
    .from("workspace_google_drive")
    .select("status, root_folder_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!connection || connection.status !== "connected" || !connection.root_folder_id) {
    const code = connection?.status === "error" ? "gdrive_reconnect_required" : "google_drive_not_connected";
    throw new Error(code);
  }
  const rootFolderId = connection.root_folder_id as string;

  const { data: secret, error } = await admin.rpc("crm_gdrive_get_credential", { p_workspace_id: workspaceId });
  if (error || typeof secret !== "string" || !secret) throw new Error("google_drive_not_connected");
  const credential = JSON.parse(secret) as GoogleCredential;
  if (credential?.type !== "google" || !credential.refresh_token) throw new Error("google_drive_not_connected");

  let accessToken: string;
  try {
    accessToken = await googleAccessToken(
      credential.refresh_token,
      requireEnv("GOOGLE_CLIENT_ID"),
      requireEnv("GOOGLE_CLIENT_SECRET"),
    );
  } catch (err) {
    await markDriveError(admin, workspaceId, err instanceof Error ? err.message : "auth_failed");
    throw new Error("gdrive_reconnect_required");
  }

  return {
    async ensureOrderFolder(order) {
      const { data: existing } = await admin
        .from("order_google_drive_folders")
        .select("drive_folder_id")
        .eq("order_id", order.orderId)
        .maybeSingle();
      if (typeof existing?.drive_folder_id === "string" && existing.drive_folder_id) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.drive_folder_id)}?fields=id,trashed`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (res.ok) {
            const meta = (await res.json()) as { trashed?: boolean };
            if (!meta.trashed) return existing.drive_folder_id;
          }
        } catch {
          // recreate
        }
      }
      try {
        const folderId = await findOrCreateFolder(
          accessToken,
          buildOrderFolderLabel(order.orderNumber, order.clientName),
          rootFolderId,
        );
        await admin.from("order_google_drive_folders").upsert(
          { order_id: order.orderId, workspace_id: workspaceId, drive_folder_id: folderId },
          { onConflict: "order_id" },
        );
        return folderId;
      } catch (err) {
        if (isGoogleAuthError(err)) {
          await markDriveError(admin, workspaceId, err instanceof Error ? err.message : "auth");
          throw new Error("gdrive_reconnect_required");
        }
        throw err;
      }
    },

    async upload(folderRef, fileName, bytes, mimeType) {
      try {
        const uploaded = await uploadBytesToDrive(accessToken, folderRef, fileName, bytes, mimeType);
        return {
          storageProvider: "google_drive",
          driveFileId: uploaded.fileId,
          driveFolderId: folderRef,
          nasPath: null,
        };
      } catch (err) {
        if (isGoogleAuthError(err)) {
          await markDriveError(admin, workspaceId, err instanceof Error ? err.message : "auth");
          throw new Error("gdrive_reconnect_required");
        }
        throw err;
      }
    },

    async download(attachment, variant) {
      if (!attachment.drive_file_id) throw new Error("invalid_args");
      try {
        return variant === "thumb"
          ? await downloadDriveThumbnail(accessToken, attachment.drive_file_id)
          : await downloadDriveFile(accessToken, attachment.drive_file_id);
      } catch (err) {
        if (isGoogleAuthError(err)) {
          await markDriveError(admin, workspaceId, err instanceof Error ? err.message : "auth");
          throw new Error("gdrive_reconnect_required");
        }
        throw err;
      }
    },

    async remove(attachment) {
      if (!attachment.drive_file_id) return;
      try {
        await trashDriveFile(accessToken, attachment.drive_file_id);
      } catch (err) {
        console.error("[drive adapter] trash file", err);
      }
    },

    async trashOrderFolder(orderId) {
      const { data: folder } = await admin
        .from("order_google_drive_folders")
        .select("drive_folder_id")
        .eq("order_id", orderId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!folder?.drive_folder_id) return;
      try {
        await trashDriveFile(accessToken, folder.drive_folder_id);
      } catch (err) {
        console.error("[drive adapter] trash folder", err);
      }
      await admin.from("order_google_drive_folders").delete().eq("order_id", orderId).eq("workspace_id", workspaceId);
    },
  };
}

export async function createNasAdapter(admin: Admin, workspaceId: string): Promise<RemoteAttachmentAdapter> {
  const { data: connection } = await admin
    .from("workspace_nas_storage")
    .select("protocol, base_url, root_path, username, bucket, region, status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!connection || connection.status !== "connected") {
    throw new Error(connection?.status === "error" ? "nas_reconnect_required" : "nas_not_connected");
  }

  const { data: secret, error } = await admin.rpc("crm_nas_get_credential", { p_workspace_id: workspaceId });
  if (error || typeof secret !== "string" || !secret) throw new Error("nas_not_connected");

  let credential: NasCredential;
  try {
    credential = parseNasCredential(secret);
  } catch {
    throw new Error("nas_not_connected");
  }

  const protocol = connection.protocol === "s3" ? "s3" : "webdav";
  const root = normalizeRootPath(typeof connection.root_path === "string" ? connection.root_path : "/CoreApp");
  let base: URL;
  try {
    base = await assertNasUrlSafe(String(connection.base_url ?? ""));
  } catch (err) {
    await markNasError(admin, workspaceId, err instanceof Error ? err.message : "ssrf");
    throw new Error("nas_reconnect_required");
  }

  const wrapNas = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "nas_error";
      await markNasError(admin, workspaceId, message);
      if (err instanceof NasClientError && (err.code === "auth_failed" || err.code === "forbidden")) {
        throw new Error("nas_reconnect_required");
      }
      throw new Error("nas_reconnect_required");
    }
  };

  const rememberNasFolder = async (orderId: string, kind: "webdav" | "s3", folderPath: string) => {
    const { error } = await admin
      .from("order_nas_folders")
      .upsert({ order_id: orderId, workspace_id: workspaceId, protocol: kind, folder_path: folderPath }, { onConflict: "order_id" });
    if (error) console.error("[nas adapter] remember folder", error.message);
  };

  return {
    async ensureOrderFolder(order) {
      const label = buildOrderFolderLabel(order.orderNumber, order.clientName);
      if (protocol === "webdav") {
        if (credential.type !== "webdav") throw new Error("nas_not_connected");
        const username = String(connection.username ?? "");
        const folderPath = joinNasPath(root, label);
        await wrapNas(() => webdavEnsureDir(base, folderPath, username, credential.password));
        await rememberNasFolder(order.orderId, "webdav", folderPath);
        return folderPath;
      }
      // S3 has no real folders — return prefix
      const prefix = joinNasPath(root, sanitizeAttachmentFileName(order.orderNumber || "order")).replace(/^\//, "");
      await rememberNasFolder(order.orderId, "s3", prefix);
      return prefix;
    },

    async upload(folderRef, fileName, bytes, mimeType) {
      const safeName = sanitizeAttachmentFileName(fileName);
      if (protocol === "webdav") {
        if (credential.type !== "webdav") throw new Error("nas_not_connected");
        const username = String(connection.username ?? "");
        const nasPath = joinNasPath(folderRef, safeName);
        await wrapNas(() => webdavPut(base, nasPath, bytes, mimeType, username, credential.password));
        return { storageProvider: "nas", nasPath, driveFileId: null, driveFolderId: null };
      }
      if (credential.type !== "s3") throw new Error("nas_not_connected");
      const bucket = String(connection.bucket ?? "");
      const region = String(connection.region ?? "us-east-1") || "us-east-1";
      const key = `${folderRef.replace(/\/$/, "")}/${crypto.randomUUID()}-${safeName}`.replace(/^\/+/, "");
      await wrapNas(() =>
        s3PutObject({
          base,
          bucket,
          region,
          key,
          bytes,
          mimeType,
          accessKeyId: credential.access_key_id,
          secretAccessKey: credential.secret_access_key,
        }),
      );
      return { storageProvider: "nas", nasPath: `/${key}`, driveFileId: null, driveFolderId: null };
    },

    async download(attachment, _variant) {
      // NAS has no thumbnails — always full.
      if (!attachment.nas_path) throw new Error("invalid_args");
      if (protocol === "webdav") {
        if (credential.type !== "webdav") throw new Error("nas_not_connected");
        const username = String(connection.username ?? "");
        return wrapNas(() => webdavGet(base, attachment.nas_path!, username, credential.password));
      }
      if (credential.type !== "s3") throw new Error("nas_not_connected");
      const bucket = String(connection.bucket ?? "");
      const region = String(connection.region ?? "us-east-1") || "us-east-1";
      const key = attachment.nas_path.replace(/^\//, "");
      return wrapNas(() =>
        s3GetObject({
          base,
          bucket,
          region,
          key,
          accessKeyId: credential.access_key_id,
          secretAccessKey: credential.secret_access_key,
        }),
      );
    },

    async remove(attachment) {
      if (!attachment.nas_path) return;
      try {
        if (protocol === "webdav") {
          if (credential.type !== "webdav") return;
          const username = String(connection.username ?? "");
          await webdavDelete(base, attachment.nas_path, username, credential.password);
          return;
        }
        if (credential.type !== "s3") return;
        await s3DeleteObject({
          base,
          bucket: String(connection.bucket ?? ""),
          region: String(connection.region ?? "us-east-1") || "us-east-1",
          key: attachment.nas_path.replace(/^\//, ""),
          accessKeyId: credential.access_key_id,
          secretAccessKey: credential.secret_access_key,
        });
      } catch (err) {
        console.error("[nas adapter] remove", err);
      }
    },

    async trashOrderFolder(orderId) {
      // Folder reference survives order deletion (order_nas_folders has no FK to orders).
      const { data: folder } = await admin
        .from("order_nas_folders")
        .select("protocol, folder_path")
        .eq("order_id", orderId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!folder?.folder_path) return;
      if (folder.protocol === "webdav" && protocol === "webdav" && credential.type === "webdav") {
        const folderPath = String(folder.folder_path);
        try {
          const username = String(connection.username ?? "");
          await webdavDelete(base, folderPath.endsWith("/") ? folderPath : `${folderPath}/`, username, credential.password);
        } catch (err) {
          console.error("[nas adapter] trash folder", err);
        }
      } else {
        // S3: objects under the prefix are left in place (no list/delete-by-prefix); log for the owner.
        console.warn("[nas adapter] s3 prefix left in place after order delete", folder.folder_path);
      }
      await admin.from("order_nas_folders").delete().eq("order_id", orderId).eq("workspace_id", workspaceId);
    },
  };
}

export async function createRemoteAdapter(
  admin: Admin,
  workspaceId: string,
  mode: RemoteProvider,
): Promise<RemoteAttachmentAdapter> {
  if (mode === "google_drive") return createDriveAdapter(admin, workspaceId);
  return createNasAdapter(admin, workspaceId);
}

export function isRemoteReconnectError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /gdrive_reconnect_required|nas_reconnect_required|google_drive_not_connected|nas_not_connected/i.test(msg);
}

export function reconnectErrorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/nas_/i.test(msg)) return "nas_reconnect_required";
  return "gdrive_reconnect_required";
}
