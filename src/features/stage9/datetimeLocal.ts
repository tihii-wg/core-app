function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** ISO timestamp -> `YYYY-MM-DDTHH:mm` in the browser's local zone (for `<input type="datetime-local">`). "" if invalid. */
export function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value (local time) -> ISO timestamp, or null when blank/invalid. */
export function fromDatetimeLocalValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
