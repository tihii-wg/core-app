/** Backup archive manifest (format version 1). */

export type BackupTableCount = { name: string; rowCount: number };

export type BackupManifest = {
  format: "core-app-workspace-backup";
  version: 1;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  tables: BackupTableCount[];
  files: number;
  appVersion: string;
  warnings?: string[];
};

export function buildBackupManifest(input: {
  workspaceId: string;
  workspaceName: string;
  createdAt?: string;
  tables: BackupTableCount[];
  files: number;
  appVersion?: string;
  warnings?: string[];
}): BackupManifest {
  const manifest: BackupManifest = {
    format: "core-app-workspace-backup",
    version: 1,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    createdAt: input.createdAt ?? new Date().toISOString(),
    tables: input.tables,
    files: input.files,
    appVersion: input.appVersion ?? "1",
  };
  if (input.warnings && input.warnings.length > 0) {
    manifest.warnings = [...input.warnings];
  }
  return manifest;
}
