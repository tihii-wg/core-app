import { describe, expect, it } from "vitest";
import { DEMO_PRINT_SOURCE_ID, demoPrintContext } from "./demoPrintContext";
import { isDemoPrintSource } from "./templatePreviewHtml";

describe("designer demo data default", () => {
  it("treats the demo sentinel as the default preview source", () => {
    expect(isDemoPrintSource("")).toBe(true);
    expect(isDemoPrintSource(DEMO_PRINT_SOURCE_ID)).toBe(true);
    expect(isDemoPrintSource("o1")).toBe(false);
    const ctx = demoPrintContext({ documentType: "work_order", locale: "en", currency: "MDL" });
    expect(ctx.order?.orderNumber).toBe("ORD-2026-0001");
    expect(ctx.documentKind).toBe("work_order");
  });
});
