/** Keep the newest `retentionCount` backup files; return names to delete. */

export type RetentionFile = {
  name: string;
  /** Sort key: higher = newer. Prefer createdAtMs when known, else parse from filename. */
  createdAtMs: number;
};

export function selectBackupFilesToDelete(files: RetentionFile[], retentionCount: number): string[] {
  const keep = Math.max(1, Math.min(90, Math.floor(retentionCount) || 1));
  const sorted = [...files].sort((a, b) => b.createdAtMs - a.createdAtMs);
  return sorted.slice(keep).map((file) => file.name);
}

/** Parse `…-YYYY-MM-DD_HHmm.zip` → epoch ms (UTC), or 0 when unparseable. */
export function backupNameTimestampMs(name: string): number {
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.zip$/i);
  if (!match) return 0;
  const [, y, m, d, hh, mm] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  return Number.isFinite(ms) ? ms : 0;
}
