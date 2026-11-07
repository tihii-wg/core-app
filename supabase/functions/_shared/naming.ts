/** Backup file naming / slug helpers (pure). */

const SLUG_MAX = 48;

/** Workspace name → filesystem-safe slug for backup filenames. */
export function workspaceSlug(name: string | null | undefined): string {
  const raw = (name ?? "").trim().toLowerCase();
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
  return slug || "workspace";
}

/** Format: core-app-backup-<slug>-<YYYY-MM-DD_HHmm>.zip (UTC). */
export function backupFileName(workspaceName: string | null | undefined, at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `core-app-backup-${workspaceSlug(workspaceName)}-${y}-${m}-${d}_${hh}${mm}.zip`;
}

export function isBackupZipName(name: string): boolean {
  return /^core-app-backup-.+-\d{4}-\d{2}-\d{2}_\d{4}\.zip$/i.test(name.trim());
}
