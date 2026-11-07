import { buildWorkspaceArchive } from "../_shared/archive.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import {
  ensureDriveBackupFolder,
  enforceDriveRetention,
  googleAccessToken,
  uploadZipToDrive,
  type GoogleCredential,
} from "../_shared/googleDrive.ts";
import { GITHUB_MAX_ARCHIVE_BYTES, uploadZipToGitHub, type GitHubCredential } from "../_shared/github.ts";
import { backupFileName } from "../_shared/naming.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";

const TIME_BUDGET_MS = 120_000;

type BackupSettings = {
  workspace_id: string;
  provider: "github" | "google_drive" | null;
  include_files: boolean;
  retention_count: number;
  github_repo: string | null;
  github_branch: string | null;
  github_path: string | null;
  google_folder_id: string | null;
};

Deno.serve(async (req) => {
  const appUrl = Deno.env.get("APP_URL") ?? undefined;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  try {
    const cronToken = req.headers.get("x-backup-cron-token");
    const expectedCron = Deno.env.get("BACKUP_CRON_TOKEN") ?? "";
    if (cronToken && expectedCron && timingSafeEqual(cronToken, expectedCron)) {
      return await handleScheduled(appUrl);
    }

    if (req.method !== "POST") {
      return errorResponse("method_not_allowed", "POST required", 405, appUrl);
    }

    const jwt = bearerToken(req);
    if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

    const body = (await req.json()) as { workspaceId?: string; runId?: string; download?: boolean };
    const workspaceId = body.workspaceId?.trim() ?? "";
    const runId = body.runId?.trim() ?? "";
    if (!workspaceId || !runId) {
      return errorResponse("invalid_args", "workspaceId and runId are required", 400, appUrl);
    }

    return await handleManual({
      jwt,
      workspaceId,
      runId,
      download: body.download === true,
      appUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider_error";
    console.error("[workspace-backup]", message);
    return errorResponse("provider_error", message, 500, Deno.env.get("APP_URL") ?? undefined);
  }
});

async function handleScheduled(appUrl: string | undefined): Promise<Response> {
  const admin = serviceClient();
  const { data: due, error } = await admin.rpc("crm_backup_due_workspaces", {
    p_now: new Date().toISOString(),
  });
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);

  const workspaceIds = (Array.isArray(due) ? due : []) as string[];
  const started = Date.now();
  let processed = 0;

  for (const workspaceId of workspaceIds) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const { data: settings } = await admin
      .from("workspace_backup_settings")
      .select(
        "workspace_id, provider, include_files, retention_count, github_repo, github_branch, github_path, google_folder_id",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!settings?.provider) continue;

    const { data: run, error: insertError } = await admin
      .from("workspace_backup_runs")
      .insert({
        workspace_id: workspaceId,
        status: "queued",
        trigger: "schedule",
        provider: settings.provider,
      })
      .select("id")
      .maybeSingle();
    if (insertError || !run?.id) continue;

    await processRun({
      admin,
      workspaceId,
      runId: run.id as string,
      settings: settings as BackupSettings,
      download: false,
    });
    processed += 1;
  }

  return jsonResponse({ ok: true, due: workspaceIds.length, processed }, 200, appUrl);
}

async function handleManual(input: {
  jwt: string;
  workspaceId: string;
  runId: string;
  download: boolean;
  appUrl: string | undefined;
}): Promise<Response> {
  const user = userClient(input.jwt);
  const { data: isOwner, error: ownerError } = await user.rpc("crm_is_workspace_owner_id", {
    p_workspace_id: input.workspaceId,
  });
  if (ownerError || isOwner !== true) {
    return errorResponse("owner_only", "Only the workspace owner can run backups", 403, input.appUrl);
  }

  const admin = serviceClient();
  const { data: run, error: runError } = await admin
    .from("workspace_backup_runs")
    .select("id, workspace_id, status, trigger")
    .eq("id", input.runId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (runError || !run) {
    return errorResponse("not_found", "Backup run not found", 404, input.appUrl);
  }
  if (run.status !== "queued") {
    return errorResponse("invalid_args", "Run is not queued", 409, input.appUrl);
  }

  const { data: settings } = await admin
    .from("workspace_backup_settings")
    .select(
      "workspace_id, provider, include_files, retention_count, github_repo, github_branch, github_path, google_folder_id",
    )
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  const result = await processRun({
    admin,
    workspaceId: input.workspaceId,
    runId: input.runId,
    settings: (settings as BackupSettings | null) ?? {
      workspace_id: input.workspaceId,
      provider: null,
      include_files: true,
      retention_count: 14,
      github_repo: null,
      github_branch: null,
      github_path: null,
      google_folder_id: null,
    },
    download: input.download,
  });

  if (input.download && result.zipBytes) {
    return new Response(result.zipBytes, {
      status: 200,
      headers: {
        ...corsHeaders(input.appUrl),
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Backup-Status": result.status,
        "X-Backup-Location": result.location ?? "",
      },
    });
  }

  if (result.status === "failed") {
    return errorResponse("provider_error", result.error || "Backup failed", 500, input.appUrl);
  }
  return jsonResponse(
    { ok: true, runId: input.runId, status: result.status, location: result.location, fileName: result.fileName },
    200,
    input.appUrl,
  );
}

async function processRun(input: {
  admin: ReturnType<typeof serviceClient>;
  workspaceId: string;
  runId: string;
  settings: BackupSettings;
  download: boolean;
}): Promise<{ status: string; location: string | null; fileName: string; error: string | null; zipBytes: Uint8Array | null }> {
  const { admin, workspaceId, runId, settings } = input;
  await admin
    .from("workspace_backup_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);

  const { data: workspace } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const workspaceName = (workspace?.name as string | undefined)?.trim() || "Workspace";
  const fileName = backupFileName(workspaceName);
  const maxFilesMb = Number(Deno.env.get("BACKUP_MAX_FILES_MB") || "150");

  try {
    const archive = await buildWorkspaceArchive({
      admin,
      workspaceId,
      workspaceName,
      includeFiles: settings.include_files !== false,
      maxFilesMb: Number.isFinite(maxFilesMb) ? maxFilesMb : 150,
    });

    let location: string | null = null;
    const warningText = archive.warnings.length > 0 ? archive.warnings.join(" ") : null;

    if (settings.provider === "google_drive") {
      location = await uploadGoogle(admin, workspaceId, settings, workspaceName, fileName, archive.bytes);
    } else if (settings.provider === "github") {
      location = await uploadGitHub(admin, workspaceId, settings, fileName, archive.bytes);
    } else if (!input.download) {
      // Manual download-only without provider is fine; scheduled without provider should not happen.
    }

    const errorField = warningText;
    await admin
      .from("workspace_backup_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        size_bytes: archive.bytes.byteLength,
        file_name: fileName,
        location,
        error: errorField,
        provider: settings.provider,
      })
      .eq("id", runId);

    await admin
      .from("workspace_backup_settings")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "success",
        last_error: errorField,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);

    return {
      status: "success",
      location,
      fileName,
      error: errorField,
      zipBytes: input.download ? archive.bytes : null,
    };
  } catch (error) {
    const message = mapProviderError(error);
    await admin
      .from("workspace_backup_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: message,
        file_name: fileName,
      })
      .eq("id", runId);
    await admin
      .from("workspace_backup_settings")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);
    return { status: "failed", location: null, fileName, error: message, zipBytes: null };
  }
}

async function uploadGoogle(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  settings: BackupSettings,
  workspaceName: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const { data: secret, error } = await admin.rpc("crm_backup_get_credential", { p_workspace_id: workspaceId });
  if (error || !secret) throw Object.assign(new Error("not_connected"), { name: "not_connected" });
  const credential = JSON.parse(secret as string) as GoogleCredential;
  if (credential.type !== "google" || !credential.refresh_token) {
    throw Object.assign(new Error("not_connected"), { name: "not_connected" });
  }
  const accessToken = await googleAccessToken(
    credential.refresh_token,
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
  );
  const folderId = await ensureDriveBackupFolder(accessToken, workspaceName, settings.google_folder_id);
  if (folderId !== settings.google_folder_id) {
    await admin.from("workspace_backup_settings").update({ google_folder_id: folderId }).eq("workspace_id", workspaceId);
  }
  const uploaded = await uploadZipToDrive(accessToken, folderId, fileName, bytes);
  await enforceDriveRetention(accessToken, folderId, settings.retention_count ?? 14);
  return uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.fileId}/view`;
}

async function uploadGitHub(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  settings: BackupSettings,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.byteLength > GITHUB_MAX_ARCHIVE_BYTES) {
    throw Object.assign(
      new Error(
        "Archive is too large for GitHub (max ~95 MB). Use Google Drive or turn off file attachments.",
      ),
      { name: "too_large" },
    );
  }
  const { data: secret, error } = await admin.rpc("crm_backup_get_credential", { p_workspace_id: workspaceId });
  if (error || !secret) throw Object.assign(new Error("not_connected"), { name: "not_connected" });
  const credential = JSON.parse(secret as string) as GitHubCredential;
  if (credential.type !== "github" || !credential.token) {
    throw Object.assign(new Error("not_connected"), { name: "not_connected" });
  }
  const repo = settings.github_repo?.trim();
  if (!repo) throw new Error("github_repo_required");
  const uploaded = await uploadZipToGitHub({
    token: credential.token,
    repo,
    branch: settings.github_branch?.trim() || "main",
    pathPrefix: settings.github_path?.trim() || "core-app-backups",
    fileName,
    bytes,
    retentionCount: settings.retention_count ?? 14,
  });
  return uploaded.htmlUrl;
}

function mapProviderError(error: unknown): string {
  if (!(error instanceof Error)) return "Backup failed";
  if (error.name === "too_large" || error.message === "too_large") {
    return "Archive is too large for GitHub (max ~95 MB). Use Google Drive or exclude files.";
  }
  if (error.name === "not_connected" || error.message === "not_connected") {
    return "Backup provider is not connected";
  }
  if (error.name === "repo_not_private") return "GitHub repository must be private";
  return error.message || "Backup failed";
}
