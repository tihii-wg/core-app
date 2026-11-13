/** Google Calendar event colorId → hex (standard palette). */

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

/** Prefer event colorId hex, else calendar background. */
export function resolveEventCalendarColor(
  calendarBackground: string | null | undefined,
  colorId: string | null | undefined,
): string | null {
  return googleEventColorIdToHex(colorId) ?? (calendarBackground?.trim() || null);
}

export function composeFullCalendarEventId(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

export function splitFullCalendarEventId(composite: string): { calendarId: string; eventId: string } | null {
  const idx = composite.indexOf(":");
  if (idx <= 0) return null;
  return { calendarId: composite.slice(0, idx), eventId: composite.slice(idx + 1) };
}

export function isWritableAccessRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  return r === "owner" || r === "writer";
}

export function isBusyOnlyAccessRole(role: string | null | undefined): boolean {
  return (role ?? "").toLowerCase() === "freebusyreader";
}

/** Readable text on a hex background (simple luminance). */
export function contrastingTextColor(hex: string | null | undefined): string {
  const raw = (hex ?? "").replace("#", "");
  if (raw.length !== 6) return "#1a1a1a";
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? "#1a1a1a" : "#ffffff";
}
