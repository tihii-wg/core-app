import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { buildBackupManifest, type BackupManifest, type BackupTableCount } from "./manifest.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const PAGE = 1000;
const ORDER_ATTACHMENTS_BUCKET = "order-attachments";
const WORKSPACE_BUCKET = "workspace";

export type ArchiveBuildResult = {
  bytes: Uint8Array;
  manifest: BackupManifest;
  warnings: string[];
};

async function exportTableRows(
  admin: SupabaseClient,
  workspaceId: string,
  tableName: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.rpc("crm_backup_export_rows", {
      p_workspace_id: workspaceId,
      p_table: tableName,
      p_offset: offset,
      p_limit: PAGE,
    });
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

async function listAllPaths(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const queue: string[] = [prefix.replace(/\/$/, "")];
  while (queue.length > 0) {
    const folder = queue.shift()!;
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
    if (error || !data) continue;
    for (const entry of data) {
      const full = folder ? `${folder}/${entry.name}` : entry.name;
      // Folders have id null / metadata null in Supabase storage list
      if (entry.id == null && (entry.metadata == null || Object.keys(entry.metadata).length === 0)) {
        queue.push(full);
      } else {
        paths.push(full);
      }
    }
  }
  return paths;
}

async function collectWorkspaceFiles(
  admin: SupabaseClient,
  workspaceId: string,
  maxBytes: number,
): Promise<{ files: Record<string, Uint8Array>; warnings: string[]; count: number }> {
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  let total = 0;
  let count = 0;

  const buckets: { bucket: string; prefix: string }[] = [
    { bucket: ORDER_ATTACHMENTS_BUCKET, prefix: workspaceId },
    { bucket: WORKSPACE_BUCKET, prefix: workspaceId },
  ];

  for (const { bucket, prefix } of buckets) {
    const paths = await listAllPaths(admin, bucket, prefix);
    for (const path of paths) {
      if (total >= maxBytes) {
        warnings.push(`File size cap (${Math.round(maxBytes / (1024 * 1024))} MB) reached; remaining files skipped.`);
        return { files, warnings, count };
      }
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) continue;
      const buf = new Uint8Array(await data.arrayBuffer());
      if (total + buf.byteLength > maxBytes) {
        warnings.push(`Skipped ${bucket}/${path} (would exceed file size cap).`);
        warnings.push(`File size cap (${Math.round(maxBytes / (1024 * 1024))} MB) reached; remaining files skipped.`);
        return { files, warnings, count };
      }
      files[`files/${bucket}/${path}`] = buf;
      total += buf.byteLength;
      count += 1;
    }
  }

  return { files, warnings, count };
}

export async function buildWorkspaceArchive(input: {
  admin: SupabaseClient;
  workspaceId: string;
  workspaceName: string;
  includeFiles: boolean;
  maxFilesMb: number;
  appVersion?: string;
}): Promise<ArchiveBuildResult> {
  const { data: plan, error: planError } = await input.admin.rpc("crm_backup_table_plan");
  if (planError) throw new Error(planError.message);
  const tables = (Array.isArray(plan) ? plan : []) as { table_name: string }[];

  const zipEntries: Record<string, Uint8Array> = {};
  const tableCounts: BackupTableCount[] = [];

  for (const row of tables) {
    const name = row.table_name;
    if (!name) continue;
    const rows = await exportTableRows(input.admin, input.workspaceId, name);
    zipEntries[`data/${name}.json`] = strToU8(JSON.stringify(rows));
    tableCounts.push({ name, rowCount: rows.length });
  }

  // Workspace settings row (name, currency, numbering, …) so a restore can recreate them.
  // Secret-looking columns are dropped; subscription fields are ignored on restore anyway.
  const { data: workspaceRow } = await input.admin.from("workspaces").select("*").eq("id", input.workspaceId).maybeSingle();
  if (workspaceRow) {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(workspaceRow as Record<string, unknown>)) {
      if (!/(secret|token|credential|password)/i.test(key)) safe[key] = value;
    }
    zipEntries["workspace.json"] = strToU8(JSON.stringify(safe));
  }

  const warnings: string[] = [];
  let fileCount = 0;
  if (input.includeFiles) {
    const maxBytes = Math.max(1, input.maxFilesMb) * 1024 * 1024;
    const collected = await collectWorkspaceFiles(input.admin, input.workspaceId, maxBytes);
    Object.assign(zipEntries, collected.files);
    warnings.push(...collected.warnings);
    fileCount = collected.count;
  }

  const manifest = buildBackupManifest({
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    tables: tableCounts,
    files: fileCount,
    appVersion: input.appVersion,
    warnings,
  });
  zipEntries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  const bytes = zipSync(zipEntries, { level: 6 });
  return { bytes, manifest, warnings };
}
