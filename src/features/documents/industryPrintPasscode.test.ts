import { describe, expect, it } from "vitest";
import { industryProfile } from "../industries/industryProfile";
import { defaultCanvasLayoutForIndustryDocument } from "../industries/industryDocumentLayouts";
import { knownTemplateTokens } from "./templateVariables";
import { demoPrintContext } from "./demoPrintContext";
import { renderCanvasLayoutToHtmlSync } from "./canvas/renderCanvasLayout";

describe("industry print never includes passcode", () => {
  it("does not register a passcode print token", () => {
    const tokens = [...knownTemplateTokens()];
    expect(tokens.some((token) => /PASSCODE|ПАРОЛ|UNLOCK/i.test(token))).toBe(false);
  });

  it("does not put the demo passcode into rendered device receipt HTML", () => {
    const profile = industryProfile("phone_electronics_repair");
    const spec = profile.documents.find((doc) => doc.role === "receipt");
    expect(spec).toBeTruthy();
    const layout = defaultCanvasLayoutForIndustryDocument(spec!, profile, "Receipt");
    const ctx = demoPrintContext({ documentType: "work_order", industrySlug: "phone_electronics_repair", locale: "ru" });
    expect(ctx.order?.devicePasscode).toBeTruthy();

    const html = renderCanvasLayoutToHtmlSync(layout, ctx);
    expect(html).not.toContain(ctx.order!.devicePasscode!);
    expect(html).not.toContain("demo-passcode-never-print");
    expect(html).toContain("SN-A1782-BX91");
  });
});
