export const GCAL_VIEW_STORAGE_KEY = "core-app:gcal-view";

export const GCAL_VIEW_IDS = [
  "timeGridDay",
  "timeGrid3Day",
  "timeGridWeek",
  "dayGridMonth",
  "listWeek",
] as const;

export type GcalViewId = (typeof GCAL_VIEW_IDS)[number];

export function isGcalViewId(value: string | null | undefined): value is GcalViewId {
  return Boolean(value && (GCAL_VIEW_IDS as readonly string[]).includes(value));
}

export function defaultGcalView(isMobile: boolean): GcalViewId {
  return isMobile ? "timeGridDay" : "timeGridWeek";
}

export function readStoredGcalView(isMobile: boolean): GcalViewId {
  try {
    const raw = localStorage.getItem(GCAL_VIEW_STORAGE_KEY);
    if (isGcalViewId(raw)) {
      // Desktop never restores the phone-only 3-day view as initial clutter.
      if (!isMobile && raw === "timeGrid3Day") return defaultGcalView(false);
      return raw;
    }
  } catch {
    // private mode / blocked storage
  }
  return defaultGcalView(isMobile);
}

export function writeStoredGcalView(view: string): void {
  if (!isGcalViewId(view)) return;
  try {
    localStorage.setItem(GCAL_VIEW_STORAGE_KEY, view);
  } catch {
    // ignore
  }
}
