import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import {
  defaultCanvasLayoutForIndustryDocument,
  layoutIncludesVehicleBlock,
} from "./industryDocumentLayouts";
import { industryProfile, KNOWN_INDUSTRY_SLUGS } from "./industryProfile";

beforeAll(async () => {
  await i18n.changeLanguage("ru");
});

describe("defaultCanvasLayoutForIndustryDocument", () => {
  it("includes the vehicle block only for vehicle industries", () => {
    for (const slug of KNOWN_INDUSTRY_SLUGS) {
      const profile = industryProfile(slug);
      const spec = profile.documents[0]!;
      const title = String(i18n.t(spec.nameKey as never, { defaultValue: spec.role }));
      const layout = defaultCanvasLayoutForIndustryDocument(spec, profile, title, i18n.t.bind(i18n));
      expect(layoutIncludesVehicleBlock(layout)).toBe(profile.assetKind === "vehicle");
    }
  });

  it("uses the translated spec name as the layout title, never hard-coded ЗАКАЗ-НАРЯД", () => {
    const profile = industryProfile("furniture_manufacturing");
    const contract = profile.documents.find((doc) => doc.role === "contract")!;
    const title = String(i18n.t(contract.nameKey as never));
    const layout = defaultCanvasLayoutForIndustryDocument(contract, profile, title, i18n.t.bind(i18n));
    const titleEl = layout.elements.find(
      (el) => el.type === "text" && typeof el.content === "string" && el.content.includes("#ЗАКАЗ-НОМЕР"),
    );
    expect(titleEl && "content" in titleEl ? String(titleEl.content) : "").toContain(title);
    expect(titleEl && "content" in titleEl ? String(titleEl.content) : "").not.toContain("ЗАКАЗ-НАРЯД");
  });
});
