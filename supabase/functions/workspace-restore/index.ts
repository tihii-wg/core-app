/**
 * Restore a workspace backup ZIP into a NEW workspace (owner of the source workspace only).
 *
 * The browser unzips the archive and calls:
 *   POST /workspace-restore/data    body (optionally gzip, header x-body-encoding: gzip):
 *        { manifest, workspace, tables: { <table>: rows[] }, files: ["files/<bucket>/<path>", …], name }
 *        → { jobId, workspaceId, restored, skipped, filesTotal }
 *   POST /workspace-restore/file?job=<id>&key=<bucket>/<path>   raw file bytes  → { ok }
 *   POST /workspace-restore/finish  { jobId }                    → { ok }
 * All database work runs in one transaction (crm_backup_restore_workspace); files are uploaded one by one.
 */
import { corsOriginFor, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { isUuid, remapBackup } from "../_shared/restoreRemap.ts";
import { bearerToken, serviceClient } from "../_shared/supabase.ts";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

type Manifest = { format?: string; version?: number; workspaceId?: string; workspaceName?: string };

function corsFor(req: Request) {
  return corsOriginFor(Deno.env.get("APP_URL") ?? undefined, req);
}

async function readJsonBody(req: Request): Promise<unknown> {
  if (req.headers.get("x-body-encoding") === "gzip" && req.body) {
    const text = await new Response(req.body.pipeThrough(new DecompressionStream("gzip"))).text();
    return JSON.parse(text);
  }
  return await req.json();
}

Deno.serve(async (req) => {
  const origin = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-body-encoding",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  if (req.method !== "POST") return errorResponse("method_not_allowed", "POST required", 405, origin);

  try {
    const jwt = bearerToken(req);
    if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, origin);
    const { data: userData, error: userError } = await serviceClient().auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (userError || !userId) return errorResponse("unauthorized", "Invalid session", 401, origin);

    const path = new URL(req.url).pathname;
    if (path.endsWith("/data")) return await handleData(req, userId, origin);
    if (path.endsWith("/file")) return await handleFile(req, userId, origin);
    if (path.endsWith("/finish")) return await handleFinish(req, userId, origin);
    return errorResponse("not_found", "Unknown route", 404, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "restore_failed";
    console.error("[workspace-restore]", message);
    return errorResponse("restore_failed", message, 500, origin);
  }
});

async function handleData(req: Request, userId: string, origin: string): Promise<Response> {
  const body = (await readJsonBody(req)) as {
    manifest?: Manifest;
    workspace?: Record<string, unknown> | null;
    tables?: Record<string, unknown[]>;
    files?: string[];
    name?: string;
  };
  const manifest = body.manifest ?? {};
  if (manifest.format !== "core-app-workspace-backup" || manifest.version !== 1 || !isUuid(manifest.workspaceId)) {
    return errorResponse("invalid_backup", "Not a Core App workspace backup", 400, origin);
  }
  if (!body.tables || typeof body.tables !== "object") {
    return errorResponse("invalid_backup", "Backup has no data", 400, origin);
  }
  const sourceWorkspaceId = manifest.workspaceId.toLowerCase();
  const admin = serviceClient();

  const { data: source } = await admin
    .from("workspaces")
    .select("id")
    .eq("id", sourceWorkspaceId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!source) {
    return errorResponse("owner_only", "Only the owner of the backed-up workspace can restore it", 403, origin);
  }

  const { data: plan, error: planError } = await admin.rpc("crm_backup_restore_tables");
  if (planError) throw new Error(planError.message);
  const planRows = (plan ?? []) as { table_name: string; skip_reason: string | null }[];
  const restorable = new Set(planRows.filter((row) => !row.skip_reason).map((row) => row.table_name));
  const skipped: Record<string, string> = {};
  for (const [name, rows] of Object.entries(body.tables)) {
    if (restorable.has(name) || !Array.isArray(rows) || rows.length === 0) continue;
    skipped[name] = planRows.find((row) => row.table_name === name)?.skip_reason ?? "not_in_schema";
  }

  const targetWorkspaceId = crypto.randomUUID();
  const remapped = remapBackup({
    restorable,
    sourceWorkspaceId,
    targetWorkspaceId,
    tables: body.tables,
    workspace: body.workspace && typeof body.workspace === "object" ? body.workspace : null,
    files: Array.isArray(body.files) ? body.files.filter((f) => typeof f === "string") : [],
    newId: () => crypto.randomUUID(),
  });

  const { data: job, error: jobError } = await admin
    .from("workspace_restore_jobs")
    .insert({ user_id: userId, source_workspace_id: sourceWorkspaceId, status: "running" })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(jobError?.message ?? "job_create_failed");

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : null;
  const { data: result, error: restoreError } = await admin.rpc("crm_backup_restore_workspace", {
    p_user: userId,
    p_source: sourceWorkspaceId,
    p_target: targetWorkspaceId,
    p_name: name,
    p_workspace: remapped.workspace,
    p_tables: remapped.tables,
    p_foreign_uuids: remapped.foreignUuids,
  });
  if (restoreError) {
    await admin
      .from("workspace_restore_jobs")
      .update({ status: "failed", error: restoreError.message, finished_at: new Date().toISOString() })
      .eq("id", job.id);
    const code = /owner_only/.test(restoreError.message)
      ? "owner_only"
      : /foreign_reference/.test(restoreError.message)
        ? "foreign_reference"
        : "restore_failed";
    return errorResponse(code, restoreError.message, code === "restore_failed" ? 500 : 403, origin);
  }

  const filesTotal = Object.keys(remapped.fileMap).length;
  await admin
    .from("workspace_restore_jobs")
    .update({
      target_workspace_id: targetWorkspaceId,
      status: filesTotal > 0 ? "files" : "done",
      file_map: remapped.fileMap,
      files_total: filesTotal,
      summary: result,
      finished_at: filesTotal > 0 ? null : new Date().toISOString(),
    })
    .eq("id", job.id);

  const summary = (result ?? {}) as { restored?: Record<string, number>; skipped?: Record<string, string> };
  return jsonResponse(
    {
      jobId: job.id,
      workspaceId: targetWorkspaceId,
      restored: summary.restored ?? {},
      skipped: { ...skipped, ...(summary.skipped ?? {}) },
      filesTotal,
      fileKeys: Object.keys(remapped.fileMap),
    },
    200,
    origin,
  );
}

type JobRow = {
  id: string;
  user_id: string;
  target_workspace_id: string | null;
  status: string;
  file_map: Record<string, string>;
  files_done: number;
  files_failed: number;
};

async function loadJob(userId: string, jobId: string | null): Promise<JobRow | null> {
  if (!isUuid(jobId)) return null;
  const { data } = await serviceClient()
    .from("workspace_restore_jobs")
    .select("id, user_id, target_workspace_id, status, file_map, files_done, files_failed")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

async function handleFile(req: Request, userId: string, origin: string): Promise<Response> {
  const url = new URL(req.url);
  const job = await loadJob(userId, url.searchParams.get("job"));
  if (!job || job.status !== "files") return errorResponse("invalid_job", "Restore job not found", 404, origin);

  const key = url.searchParams.get("key") ?? "";
  const target = job.file_map?.[key];
  if (!target) return errorResponse("invalid_file", "File is not part of this restore", 400, origin);
  const bucket = key.slice(0, key.indexOf("/"));

  const bytes = new Uint8Array(await req.arrayBuffer());
  const admin = serviceClient();
  if (bytes.byteLength > MAX_FILE_BYTES) {
    await admin.from("workspace_restore_jobs").update({ files_failed: job.files_failed + 1 }).eq("id", job.id);
    return errorResponse("file_too_large", "File is too large", 413, origin);
  }
  const contentType = req.headers.get("content-type") || "application/octet-stream";
  const { error } = await admin.storage.from(bucket).upload(target, bytes, { contentType, upsert: true });
  if (error) {
    await admin.from("workspace_restore_jobs").update({ files_failed: job.files_failed + 1 }).eq("id", job.id);
    return errorResponse("upload_failed", error.message, 500, origin);
  }
  await admin.from("workspace_restore_jobs").update({ files_done: job.files_done + 1 }).eq("id", job.id);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleFinish(req: Request, userId: string, origin: string): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { jobId?: string };
  const job = await loadJob(userId, body.jobId ?? null);
  if (!job) return errorResponse("invalid_job", "Restore job not found", 404, origin);
  if (job.status === "files") {
    await serviceClient()
      .from("workspace_restore_jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", job.id);
  }
  return jsonResponse({ ok: true }, 200, origin);
}
