/** Tabs for the order detail left column (history is mobile-only / right column on desktop). */
export const ORDER_DETAIL_CONTENT_TABS = ["info", "items", "payments", "files"] as const;
export type OrderDetailContentTab = (typeof ORDER_DETAIL_CONTENT_TABS)[number];
export type OrderDetailTab = OrderDetailContentTab | "history";

const WORKS_AND_MATERIALS_INDUSTRIES = new Set([
  "furniture_manufacturing",
  "home_services",
  "electrical_services",
]);

/** Module-level session memory: survives order switches; resets only on first sheet open in a session. */
let sessionTab: OrderDetailTab = "info";
let sessionHasOpened = false;

export function peekOrderDetailTab(): OrderDetailTab {
  return sessionTab;
}

/** First open in this JS session starts on info; later opens keep the last tab. */
export function readOrderDetailTabOnOpen(): OrderDetailTab {
  if (!sessionHasOpened) {
    sessionHasOpened = true;
    sessionTab = "info";
  }
  return sessionTab;
}

export function writeOrderDetailTab(tab: OrderDetailTab) {
  sessionTab = tab;
  sessionHasOpened = true;
}

/** Test helper — clear session memory between tests. */
export function resetOrderDetailTabSession() {
  sessionTab = "info";
  sessionHasOpened = false;
}

export function isOrderDetailTab(value: string): value is OrderDetailTab {
  return value === "history" || (ORDER_DETAIL_CONTENT_TABS as readonly string[]).includes(value);
}

export function usesWorksAndMaterialsTabLabel(industrySlug: string | null | undefined): boolean {
  return Boolean(industrySlug && WORKS_AND_MATERIALS_INDUSTRIES.has(industrySlug));
}

export function orderDetailItemsCount(serviceCount: number, materialCount: number): number {
  return Math.max(0, serviceCount) + Math.max(0, materialCount);
}
