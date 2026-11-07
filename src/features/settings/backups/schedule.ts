/** Convert a wall-clock hour in a workspace time zone to UTC hour (0–23). */

/**
 * Find the UTC hour that maps to `localHour` (0–23) in `timeZone` on the given date.
 * Uses probing (handles DST for that calendar day).
 */
export function localHourToUtcHour(localHour: number, timeZone: string, at: Date = new Date()): number {
  const hour = ((Math.floor(localHour) % 24) + 24) % 24;
  const tz = timeZone.trim() || "UTC";
  for (let utcHour = 0; utcHour < 24; utcHour += 1) {
    const probe = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), utcHour, 0, 0));
    if (localHourAt(probe, tz) === hour) return utcHour;
  }
  // Fallback: approximate offset from "now"
  const offsetHours = Math.round((localHourAt(at, tz) - at.getUTCHours() + 36) % 24) - 12;
  return (((hour - offsetHours) % 24) + 24) % 24;
}

export function utcHourToLocalHour(utcHour: number, timeZone: string, at: Date = new Date()): number {
  const hour = ((Math.floor(utcHour) % 24) + 24) % 24;
  const probe = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), hour, 0, 0));
  return localHourAt(probe, timeZone.trim() || "UTC");
}

function localHourAt(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const raw = parts.find((part) => part.type === "hour")?.value ?? "0";
    const value = Number(raw);
    return Number.isFinite(value) ? value % 24 : 0;
  } catch {
    return date.getUTCHours();
  }
}
