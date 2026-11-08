import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { totalsElementHeightFitsRows } from "../documents/canvas/tableData";
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

  it("sizes furniture and default totals boxes to fit their rows", () => {
    const profile = industryProfile("furniture_manufacturing");
    for (const spec of profile.documents) {
      const title = String(i18n.t(spec.nameKey as never, { defaultValue: spec.role }));
      const layout = defaultCanvasLayoutForIndustryDocument(spec, profile, title, i18n.t.bind(i18n));
      for (const el of layout.elements) {
        if (el.type === "totals") expect(totalsElementHeightFitsRows(el)).toBe(true);
      }
    }
  });

  it("furniture prepayment/balance invoices use a payment line table and due amount words", () => {
    const profile = industryProfile("furniture_manufacturing");
    const prepay = profile.documents.find((doc) => doc.role === "prepayment_invoice")!;
    const balance = profile.documents.find((doc) => doc.role === "balance_invoice")!;
    const prepayLayout = defaultCanvasLayoutForIndustryDocument(
      prepay,
      profile,
      "Счёт на предоплату",
      i18n.t.bind(i18n),
    );
    const balanceLayout = defaultCanvasLayoutForIndustryDocument(
      balance,
      profile,
      "Счёт на остаток",
      i18n.t.bind(i18n),
    );
    expect(prepayLayout.elements.some((el) => el.type === "table" && el.source === "prepaymentLine")).toBe(true);
    expect(balanceLayout.elements.some((el) => el.type === "table" && el.source === "balanceLine")).toBe(true);
    const prepayTotals = prepayLayout.elements.find((el) => el.type === "totals");
    const balanceTotals = balanceLayout.elements.find((el) => el.type === "totals");
    expect(prepayTotals?.type === "totals" && prepayTotals.rows.some((row) => row.key === "paidWords")).toBe(true);
    expect(balanceTotals?.type === "totals" && balanceTotals.rows.some((row) => row.key === "remainingWords")).toBe(
      true,
    );
  });
});
