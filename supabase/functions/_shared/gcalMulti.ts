/** Multi-calendar helpers for Edge (keep in sync with src/features/calendar/gcalColors.ts). */

export type VisibleCalendarSnapshot = {
  id: string;
  summary: string;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string;
};

export const GOOGLE_EVENT_COLOR_HEX: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

export function googleEventColorIdToHex(colorId: string | null | undefined): string | null {
  if (!colorId) return null;
  return GOOGLE_EVENT_COLOR_HEX[colorId.trim()] ?? null;
}

export function resolveEventCalendarColor(
  calendarBackground: string | null | undefined,
  colorId: string | null | undefined,
): string | null {
  return googleEventColorIdToHex(colorId) ?? (calendarBackground?.trim() || null);
}

export function isWritableAccessRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  return r === "owner" || r === "writer";
}

export function isBusyOnlyAccessRole(role: string | null | undefined): boolean {
  return (role ?? "").toLowerCase() === "freebusyreader";
}

export function parseVisibleCalendars(raw: unknown): VisibleCalendarSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: VisibleCalendarSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : id,
      backgroundColor: typeof row.backgroundColor === "string" ? row.backgroundColor : null,
      foregroundColor: typeof row.foregroundColor === "string" ? row.foregroundColor : null,
      accessRole: typeof row.accessRole === "string" ? row.accessRole : "reader",
    });
  }
  return out;
}

/** Drop main calendar id from the visible list (max 9). */
export function normalizeVisibleList(
  snapshots: VisibleCalendarSnapshot[],
  mainCalendarId: string,
): VisibleCalendarSnapshot[] {
  const main = mainCalendarId.trim();
  const seen = new Set<string>();
  const out: VisibleCalendarSnapshot[] = [];
  for (const s of snapshots) {
    if (!s.id || s.id === main || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= 9) break;
  }
  return out;
}
