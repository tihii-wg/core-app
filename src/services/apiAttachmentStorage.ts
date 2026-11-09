import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";

export type AttachmentStorageMode = "app" | "google_drive" | "nas";
export type WorkspaceGoogleDriveStatus = "connected" | "disconnected" | "error";
export type NasProtocol = "webdav" | "s3";
export type WorkspaceNasStatus = "connected" | "disconnected" | "error";

export type WorkspaceNasStorage = {
  workspaceId: string;
  protocol: NasProtocol;
  baseUrl: string;
  rootPath: string;
  username: string | null;
  bucket: string | null;
  region: string | null;
  status: WorkspaceNasStatus;
  lastError: string | null;
  lastCheckedAt: string | null;
  /** Secrets are never returned from the DB; a connected status means a secret is saved server-side. */
  hasCredential?: boolean;
};

export type NasConnectionPayload = {
  protocol: NasProtocol;
  baseUrl: string;
  rootPath: string;
  username?: string;
  password?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  /** Edit without re-entering the secret: the server keeps the stored one. */
  keepExistingSecret?: boolean;
};

export type WorkspaceGoogleDrive = {
  workspaceId: string;
  googleAccountEmail: string | null;
  rootFolderId: string | null;
  status: WorkspaceGoogleDriveStatus;
  lastError: string | null;
};

export type WorkspaceAttachmentUsage = {
  appBytes: number;
  appFiles: number;
  driveBytes: number;
  driveFiles: number;
  nasBytes: number;
  nasFiles: number;
};

export type AttachmentStorageErrorKey = "ownerOnly" | "googleDriveNotConnected" | "nasNotConnected" | "forbidden";

export const NAS_ERROR_CODES = [
  "unreachable",
  "tls",
  "auth_failed",
  "forbidden",
  "not_found",
  "timeout",
  "https_only",
  "ssrf_blocked",
] as const;
export type NasErrorCode = (typeof NAS_ERROR_CODES)[number];

/** Map an Edge Function error code/message to a stable NAS error code (settings.storage.nas.errors.<code>). */
export function nasErrorCode(message: string | null | undefined): NasErrorCode | null {
  const text = message ?? "";
  return NAS_ERROR_CODES.find((code) => new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`, "i").test(text)) ?? null;
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

/** Map RPC / Edge Function error text to a stable key under settings.storage.errors.* */
export function attachmentStorageErrorKey(message: string | null | undefined): AttachmentStorageErrorKey | null {
  const text = message ?? "";
  if (/owner_only/i.test(text)) return "ownerOnly";
  if (/google_drive_not_connected/i.test(text)) return "googleDriveNotConnected";
  if (/nas_not_connected/i.test(text)) return "nasNotConnected";
  if (/attachment_storage:forbidden/i.test(text)) return "forbidden";
  return null;
}

function mapStorageError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const message = error?.message ?? error?.code ?? "";
  const key = attachmentStorageErrorKey(message);
  if (key) return i18n.t(`settings.storage.errors.${key}`);
  return message.trim() || fallback;
}

/** Like mapStorageError, but also translates NAS connection codes (matched on code first, then message). */
function mapNasError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  // Owner/membership errors (e.g. attachment_storage:forbidden) keep priority over NAS codes.
  if (attachmentStorageErrorKey(error?.message ?? error?.code)) return mapStorageError(error, fallback);
  const code = nasErrorCode(error?.code) ?? nasErrorCode(error?.message);
  if (code) return i18n.t(`settings.storage.nas.errors.${code}`);
  return mapStorageError(error, fallback);
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function getWorkspaceGoogleDrive(workspaceId: string | undefined): Promise<WorkspaceGoogleDrive | null> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("workspace_google_drive")
    .select("workspace_id, google_account_email, root_folder_id, status, last_error")
    .eq("workspace_id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return null;
    throw new Error(mapStorageError(error, i18n.t("settings.storage.errors.loadFailed")));
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const status = row.status;
  return {
    workspaceId: String(row.workspace_id ?? id),
    googleAccountEmail: typeof row.google_account_email === "string" ? row.google_account_email : null,
    rootFolderId: typeof row.root_folder_id === "string" && row.root_folder_id ? row.root_folder_id : null,
    status: status === "connected" || status === "error" ? status : "disconnected",
    lastError: typeof row.last_error === "string" ? row.last_error : null,
  };
}

export async function getWorkspaceAttachmentUsage(workspaceId: string | undefined): Promise<WorkspaceAttachmentUsage> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("crm_workspace_attachment_usage", { p_workspace_id: id });
  if (error) {
    if (isMissingRpcError(error, "crm_workspace_attachment_usage")) {
      throw new MissingRpcError("crm_workspace_attachment_usage", i18n.t("settings.storage.unavailable"));
    }
    throw new Error(mapStorageError(error, i18n.t("settings.storage.errors.loadFailed")));
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  return {
    appBytes: toNumber(row?.app_bytes),
    appFiles: toNumber(row?.app_files),
    driveBytes: toNumber(row?.drive_bytes),
    driveFiles: toNumber(row?.drive_files),
    nasBytes: toNumber(row?.nas_bytes),
    nasFiles: toNumber(row?.nas_files),
  };
}

export async function setAttachmentStorage(
  workspaceId: string | undefined,
  mode: AttachmentStorageMode,
): Promise<AttachmentStorageMode> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("crm_set_attachment_storage", { p_workspace_id: id, p_mode: mode });
  if (error) {
    if (isMissingRpcError(error, "crm_set_attachment_storage")) {
      throw new MissingRpcError("crm_set_attachment_storage", i18n.t("settings.storage.unavailable"));
    }
    throw new Error(mapStorageError(error, i18n.t("settings.storage.errors.saveFailed")));
  }
  return data === "google_drive" || data === "app" || data === "nas" ? data : mode;
}

export async function getWorkspaceNasStorage(workspaceId: string | undefined): Promise<WorkspaceNasStorage | null> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("workspace_nas_storage")
    .select("workspace_id, protocol, base_url, root_path, username, bucket, region, status, last_error, last_checked_at")
    .eq("workspace_id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return null;
    throw new Error(mapStorageError(error, i18n.t("settings.storage.errors.loadFailed")));
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const status: WorkspaceNasStatus = row.status === "connected" || row.status === "error" ? row.status : "disconnected";
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    workspaceId: String(row.workspace_id ?? id),
    protocol: row.protocol === "s3" ? "s3" : "webdav",
    baseUrl: typeof row.base_url === "string" ? row.base_url : "",
    rootPath: typeof row.root_path === "string" && row.root_path ? row.root_path : "/CoreApp",
    username: text(row.username),
    bucket: text(row.bucket),
    region: text(row.region),
    status,
    lastError: text(row.last_error),
    lastCheckedAt: text(row.last_checked_at),
    // Secrets are never selected; "connected" means the server holds a saved credential.
    hasCredential: status === "connected",
  };
}

async function sessionAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error(i18n.t("settings.storage.errors.unauthorized"));
  return data.session.access_token;
}

function functionsBaseUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!base) throw new Error(i18n.t("settings.storage.unavailable"));
  return `${base}/functions/v1`;
}

type FunctionErrorBody = { url?: string; ok?: boolean; error?: { code?: string; message?: string } };

async function readJson(res: Response): Promise<FunctionErrorBody> {
  try {
    return (await res.json()) as FunctionErrorBody;
  } catch {
    return {};
  }
}

export async function startPhotosGoogleDriveOAuth(workspaceId: string | undefined, locale: string): Promise<string> {
  const id = requireWorkspaceId(workspaceId);
  const token = await sessionAccessToken();
  const res = await fetch(
    `${functionsBaseUrl()}/google-drive-photos-oauth/start?workspaceId=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      },
    },
  );
  const json = await readJson(res);
  if (!res.ok || !json.url) {
    throw new Error(mapStorageError(json.error ?? null, i18n.t("settings.storage.errors.connectFailed")));
  }
  return json.url;
}

export async function disconnectPhotosGoogleDrive(workspaceId: string | undefined): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const token = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/google-drive-photos-oauth/disconnect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId: id }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(mapStorageError(json.error ?? null, i18n.t("settings.storage.errors.disconnectFailed")));
  }
}

async function postNasStorage(
  action: "test" | "save" | "disconnect",
  body: Record<string, unknown>,
  fallback: string,
): Promise<void> {
  const token = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/nas-storage/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok || json.ok === false) throw new Error(mapNasError(json.error ?? null, fallback));
}

export async function testNasConnection(workspaceId: string | undefined, payload: NasConnectionPayload): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  await postNasStorage("test", { workspaceId: id, ...payload }, i18n.t("settings.storage.nas.errors.testFailed"));
}

export async function saveNasConnection(workspaceId: string | undefined, payload: NasConnectionPayload): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  await postNasStorage("save", { workspaceId: id, ...payload }, i18n.t("settings.storage.nas.errors.saveFailed"));
}

export async function disconnectNasStorage(workspaceId: string | undefined): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  await postNasStorage("disconnect", { workspaceId: id }, i18n.t("settings.storage.nas.errors.disconnectFailed"));
}
