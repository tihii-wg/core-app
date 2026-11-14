import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";

export type BackupProvider = "github" | "google_drive";
export type BackupFrequency = "daily" | "weekly";
export type BackupRunStatus = "queued" | "running" | "success" | "failed";
export type BackupRunTrigger = "manual" | "schedule";

export type WorkspaceBackupSettings = {
  workspaceId: string;
  provider: BackupProvider | null;
  enabled: boolean;
  frequency: BackupFrequency;
  hourUtc: number;
  weekday: number;
  retentionCount: number;
  includeFiles: boolean;
  githubRepo: string | null;
  githubBranch: string | null;
  githubPath: string | null;
  googleFolderId: string | null;
  googleAccountEmail: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string | null;
  credentialConnected: boolean;
};

export type WorkspaceBackupRun = {
  id: string;
  workspaceId: string;
  status: BackupRunStatus;
  trigger: BackupRunTrigger;
  provider: BackupProvider | null;
  startedAt: string | null;
  finishedAt: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  location: string | null;
  error: string | null;
  createdAt: string;
};

export type BackupSettingsPatch = {
  provider?: BackupProvider | null;
  enabled?: boolean;
  frequency?: BackupFrequency;
  hourUtc?: number;
  weekday?: number;
  retentionCount?: number;
  includeFiles?: boolean;
  githubRepo?: string | null;
  githubBranch?: string | null;
  githubPath?: string | null;
};

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

export type BackupErrorKey = "ownerOnly" | "alreadyRunning" | "repoNotPrivate" | "tooLarge" | "notConnected";

/** Map provider / RPC error text to a stable i18n key under settings.backups.errors.* */
export function backupErrorKey(message: string | null | undefined): BackupErrorKey | null {
  const text = message ?? "";
  if (/owner_only/i.test(text)) return "ownerOnly";
  if (/already_running/i.test(text)) return "alreadyRunning";
  if (/repo_not_private/i.test(text)) return "repoNotPrivate";
  if (/too_large/i.test(text)) return "tooLarge";
  if (/not_connected/i.test(text)) return "notConnected";
  return null;
}

function backupErrorMessage(key: BackupErrorKey): string {
  switch (key) {
    case "ownerOnly":
      return i18n.t("settings.backups.errors.ownerOnly");
    case "alreadyRunning":
      return i18n.t("settings.backups.errors.alreadyRunning");
    case "repoNotPrivate":
      return i18n.t("settings.backups.errors.repoNotPrivate");
    case "tooLarge":
      return i18n.t("settings.backups.errors.tooLarge");
    case "notConnected":
      return i18n.t("settings.backups.errors.notConnected");
  }
}

function mapBackupError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const message = error?.message ?? error?.code ?? "";
  const key = backupErrorKey(message);
  if (key) return backupErrorMessage(key);
  return message.trim() || fallback;
}

function toSettings(row: Record<string, unknown>, credentialConnected: boolean): WorkspaceBackupSettings {
  return {
    workspaceId: String(row.workspace_id),
    provider: row.provider === "github" || row.provider === "google_drive" ? row.provider : null,
    enabled: row.enabled === true,
    frequency: row.frequency === "weekly" ? "weekly" : "daily",
    hourUtc: Number(row.hour_utc ?? 1),
    weekday: Number(row.weekday ?? 0),
    retentionCount: Number(row.retention_count ?? 14),
    includeFiles: row.include_files !== false,
    githubRepo: typeof row.github_repo === "string" ? row.github_repo : null,
    githubBranch: typeof row.github_branch === "string" ? row.github_branch : null,
    githubPath: typeof row.github_path === "string" ? row.github_path : null,
    googleFolderId: typeof row.google_folder_id === "string" ? row.google_folder_id : null,
    googleAccountEmail: typeof row.google_account_email === "string" ? row.google_account_email : null,
    lastRunAt: typeof row.last_run_at === "string" ? row.last_run_at : null,
    lastStatus: typeof row.last_status === "string" ? row.last_status : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    credentialConnected,
  };
}

function toRun(row: Record<string, unknown>): WorkspaceBackupRun {
  const status = row.status;
  const trigger = row.trigger;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    status:
      status === "queued" || status === "running" || status === "success" || status === "failed" ? status : "failed",
    trigger: trigger === "schedule" ? "schedule" : "manual",
    provider: row.provider === "github" || row.provider === "google_drive" ? row.provider : null,
    startedAt: typeof row.started_at === "string" ? row.started_at : null,
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    fileName: typeof row.file_name === "string" ? row.file_name : null,
    location: typeof row.location === "string" ? row.location : null,
    error: typeof row.error === "string" ? row.error : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export async function getBackupSettings(workspaceId: string | undefined): Promise<WorkspaceBackupSettings | null> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("workspace_backup_settings")
    .select(
      "workspace_id, provider, enabled, frequency, hour_utc, weekday, retention_count, include_files, github_repo, github_branch, github_path, google_folder_id, google_account_email, last_run_at, last_status, last_error, updated_at",
    )
    .eq("workspace_id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return null;
    throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.loadFailed")));
  }

  let credentialConnected = false;
  const { data: connected, error: connectedError } = await supabase.rpc("crm_backup_credential_connected", {
    p_workspace_id: id,
  });
  if (!connectedError) credentialConnected = connected === true;
  else if (isMissingRpcError(connectedError, "crm_backup_credential_connected")) {
    throw new MissingRpcError("crm_backup_credential_connected", i18n.t("settings.backups.unavailable"));
  }

  if (!data) {
    return {
      workspaceId: id,
      provider: null,
      enabled: false,
      frequency: "daily",
      hourUtc: 1,
      weekday: 0,
      retentionCount: 14,
      includeFiles: true,
      githubRepo: null,
      githubBranch: "main",
      githubPath: "core-app-backups",
      googleFolderId: null,
      googleAccountEmail: null,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      updatedAt: null,
      credentialConnected: false,
    };
  }

  return toSettings(data as Record<string, unknown>, credentialConnected);
}

export async function updateBackupSettings(
  workspaceId: string | undefined,
  patch: BackupSettingsPatch,
): Promise<WorkspaceBackupSettings> {
  const id = requireWorkspaceId(workspaceId);
  // Column privileges (20261107140000_workspace_backups): INSERT allows only the setting columns plus
  // workspace_id (not updated_at); UPDATE allows the setting columns plus updated_at (not workspace_id).
  // A PostgREST upsert sends every payload column in both INSERT and ON CONFLICT DO UPDATE, which fails
  // with "permission denied for table workspace_backup_settings" — so update first, insert when missing.
  const fields: Record<string, unknown> = {};
  if (patch.provider !== undefined) fields.provider = patch.provider;
  if (patch.enabled !== undefined) fields.enabled = patch.enabled;
  if (patch.frequency !== undefined) fields.frequency = patch.frequency;
  if (patch.hourUtc !== undefined) fields.hour_utc = patch.hourUtc;
  if (patch.weekday !== undefined) fields.weekday = patch.weekday;
  if (patch.retentionCount !== undefined) fields.retention_count = patch.retentionCount;
  if (patch.includeFiles !== undefined) fields.include_files = patch.includeFiles;
  if (patch.githubRepo !== undefined) fields.github_repo = patch.githubRepo;
  if (patch.githubBranch !== undefined) fields.github_branch = patch.githubBranch;
  if (patch.githubPath !== undefined) fields.github_path = patch.githubPath;

  const updateExisting = async () => {
    const { data, error } = await supabase
      .from("workspace_backup_settings")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("workspace_id", id)
      .select("workspace_id");
    if (error) throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.saveFailed")));
    return Array.isArray(data) && data.length > 0;
  };

  if (!(await updateExisting())) {
    const { error } = await supabase.from("workspace_backup_settings").insert({ workspace_id: id, ...fields });
    if (error) {
      // Another tab/user created the row in between — apply the change to it.
      if (error.code !== "23505" || !(await updateExisting())) {
        throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.saveFailed")));
      }
    }
  }

  const settings = await getBackupSettings(id);
  if (!settings) throw new Error(i18n.t("settings.backups.errors.saveFailed"));
  return settings;
}

export async function listBackupRuns(workspaceId: string | undefined, limit = 30): Promise<WorkspaceBackupRun[]> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("workspace_backup_runs")
    .select(
      "id, workspace_id, status, trigger, provider, started_at, finished_at, size_bytes, file_name, location, error, created_at",
    )
    .eq("workspace_id", id)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return [];
    throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.loadFailed")));
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toRun);
}

export async function disconnectBackup(workspaceId: string | undefined): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const { error } = await supabase.rpc("crm_backup_disconnect", { p_workspace_id: id });
  if (error) {
    if (isMissingRpcError(error, "crm_backup_disconnect")) {
      throw new MissingRpcError("crm_backup_disconnect", i18n.t("settings.backups.unavailable"));
    }
    throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.disconnectFailed")));
  }
}

export async function requestBackupRun(workspaceId: string | undefined): Promise<string> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("crm_backup_request_run", { p_workspace_id: id });
  if (error) {
    if (isMissingRpcError(error, "crm_backup_request_run")) {
      throw new MissingRpcError("crm_backup_request_run", i18n.t("settings.backups.unavailable"));
    }
    throw new Error(mapBackupError(error, i18n.t("settings.backups.errors.runFailed")));
  }
  if (typeof data !== "string" || !data) throw new Error(i18n.t("settings.backups.errors.runFailed"));
  return data;
}

async function sessionAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error(i18n.t("settings.backups.errors.unauthorized"));
  return data.session.access_token;
}

function functionsBaseUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!base) throw new Error(i18n.t("settings.backups.unavailable"));
  return `${base}/functions/v1`;
}

export async function startGoogleDriveOAuth(workspaceId: string | undefined, locale: string): Promise<string> {
  const id = requireWorkspaceId(workspaceId);
  const token = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/backup-google-oauth/start?workspaceId=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
    },
  });
  const json = (await res.json()) as { url?: string; error?: { code?: string; message?: string } };
  if (!res.ok || !json.url) {
    throw new Error(mapBackupError(json.error ?? null, i18n.t("settings.backups.errors.connectFailed")));
  }
  return json.url;
}

export async function connectGitHubBackup(input: {
  workspaceId: string | undefined;
  repo: string;
  branch?: string;
  path?: string;
  token: string;
}): Promise<void> {
  const id = requireWorkspaceId(input.workspaceId);
  const accessToken = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/backup-github-connect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: id,
      repo: input.repo.trim(),
      branch: input.branch,
      path: input.path,
      token: input.token,
    }),
  });
  const json = (await res.json()) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new Error(mapBackupError(json.error ?? null, i18n.t("settings.backups.errors.connectFailed")));
  }
}

export async function invokeWorkspaceBackup(input: {
  workspaceId: string | undefined;
  runId: string;
  download?: boolean;
}): Promise<{ blob?: Blob; location?: string | null; fileName?: string }> {
  const id = requireWorkspaceId(input.workspaceId);
  const accessToken = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/workspace-backup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: id,
      runId: input.runId,
      download: input.download === true,
    }),
  });

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/zip")) {
    const blob = await res.blob();
    const fileName =
      /filename="([^"]+)"/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
      `core-app-backup-${id}.zip`;
    return { blob, fileName, location: res.headers.get("X-Backup-Location") };
  }

  const json = (await res.json()) as {
    ok?: boolean;
    location?: string | null;
    fileName?: string;
    error?: { code?: string; message?: string };
  };
  if (!res.ok) {
    throw new Error(mapBackupError(json.error ?? null, i18n.t("settings.backups.errors.runFailed")));
  }
  return { location: json.location, fileName: json.fileName };
}

export function formatBackupSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
