/** Tabs for the client detail sheet. `assets` is hidden for industries without client assets. */
export const CLIENT_DETAIL_TABS = ["general", "assets", "orders", "documents", "payments"] as const;
export type ClientDetailTab = (typeof CLIENT_DETAIL_TABS)[number];

/** Module-level session memory: survives client switches; resets only on first sheet open in a session. */
let sessionTab: ClientDetailTab = "general";
let sessionHasOpened = false;

export function peekClientDetailTab(): ClientDetailTab {
  return sessionTab;
}

/** First open in this JS session starts on general; later opens keep the last tab. */
export function readClientDetailTabOnOpen(): ClientDetailTab {
  if (!sessionHasOpened) {
    sessionHasOpened = true;
    sessionTab = "general";
  }
  return sessionTab;
}

export function writeClientDetailTab(tab: ClientDetailTab) {
  sessionTab = tab;
  sessionHasOpened = true;
}

/** Test helper — clear session memory between tests. */
export function resetClientDetailTabSession() {
  sessionTab = "general";
  sessionHasOpened = false;
}

export function isClientDetailTab(value: string): value is ClientDetailTab {
  return (CLIENT_DETAIL_TABS as readonly string[]).includes(value);
}
