import { describe, expect, it } from "vitest";
import { buildOrderDetailTabs } from "./buildOrderDetailTabs";

const t = ((key: string) => key) as unknown as Parameters<typeof buildOrderDetailTabs>[0]["t"];

describe("buildOrderDetailTabs estimates", () => {
  it("hides the payments tab when showPayments is false", () => {
    const tabs = buildOrderDetailTabs({
      t,
      industrySlug: "auto_service",
      serviceLineCount: 1,
      materialLineCount: 0,
      linkedPaymentCount: 0,
      attachmentsFetched: false,
      attachmentCount: 0,
      isDesktopFeedLayout: false,
      feedItemCount: 0,
      showPayments: false,
    });
    expect(tabs.map((tab) => tab.value)).toEqual(["info", "items", "files", "history"]);
  });

  it("keeps the payments tab for normal orders", () => {
    const tabs = buildOrderDetailTabs({
      t,
      industrySlug: "auto_service",
      serviceLineCount: 0,
      materialLineCount: 0,
      linkedPaymentCount: 2,
      attachmentsFetched: false,
      attachmentCount: 0,
      isDesktopFeedLayout: true,
      feedItemCount: null,
      showPayments: true,
    });
    expect(tabs.some((tab) => tab.value === "payments")).toBe(true);
  });
});
