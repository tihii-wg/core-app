import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { applyTemplateVariables } from "./printTemplate";
import { DEMO_LOGO_DATA_URI, demoPrintContext } from "./demoPrintContext";
import { TEMPLATE_VARIABLES } from "./templateVariables";

beforeAll(async () => {
  await i18n.changeLanguage("ru");
});

describe("demoPrintContext", () => {
  it("fills every registry token for work_order, act, and invoice", () => {
    for (const documentType of ["work_order", "act", "invoice"] as const) {
      const ctx = demoPrintContext({
        documentType,
        locale: "ru",
        currency: "MDL",
        vatRate: 20,
        now: new Date("2026-11-07T12:00:00.000Z"),
      });
      expect(ctx.logoUrl).toBe(DEMO_LOGO_DATA_URI);
      for (const variable of TEMPLATE_VARIABLES) {
        const value = variable.resolve(ctx);
        const empty =
          value == null ||
          (typeof value === "string" && value.trim() === "") ||
          (typeof value === "number" && !Number.isFinite(value));
        expect(empty, `${documentType} ${variable.token} should be non-empty`).toBe(false);
      }
    }
  });

  it("renders a filled sample work order without empty tokens in common body text", () => {
    const ctx = demoPrintContext({
      documentType: "work_order",
      locale: "ru",
      currency: "MDL",
      vatRate: 20,
      now: new Date("2026-11-07T12:00:00.000Z"),
    });
    const html = applyTemplateVariables(
      [
        "#КОМПАНИЯ-НАЗВАНИЕ",
        "#КЛИЕНТ-ИМЯ",
        "#АВТО-МАРКА",
        "#АВТО-МОДЕЛЬ",
        "#ТАБЛИЦА-УСЛУГ",
        "#ТАБЛИЦА-МАТЕРИАЛОВ",
        "#НДС",
        "#ИТОГО",
        "#ОПЛАЧЕНО",
        "#ОСТАТОК",
      ].join(" "),
      ctx,
      { locale: "ru", currency: "MDL", showCents: true },
    );
    expect(html).toContain("Демо Автосервис");
    expect(html).toContain("Иван Петров");
    expect(html).toContain("Toyota");
    expect(html).toContain("<table");
    expect(html).not.toMatch(/#[А-ЯA-Z0-9-]+/);
  });
});
