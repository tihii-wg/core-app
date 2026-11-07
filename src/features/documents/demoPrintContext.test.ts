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

  it("furniture demo has no vehicle data and no mileage in warranty", () => {
    const ctx = demoPrintContext({
      documentType: "work_order",
      locale: "ru",
      industrySlug: "furniture_manufacturing",
      now: new Date("2026-11-07T12:00:00.000Z"),
    });
    expect(ctx.vehicle).toBeNull();
    expect(ctx.order?.carNumber).toBe("");
    expect(ctx.order?.vehicleMileageSnapshot).toBeNull();
    expect(ctx.order?.device).toMatch(/Кухонный|3/);
    expect(ctx.order?.services.some((line) => /Замер|Изготовление|Монтаж/.test(line.serviceName))).toBe(true);
    expect((ctx.order?.materials ?? []).some((line) => /ЛДСП|Blum|МДФ/.test(line.itemName))).toBe(true);
    const paid = ctx.paymentBalance?.netPaid ?? 0;
    const total = ctx.paymentBalance?.total ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(paid).toBeCloseTo(total * 0.5, 1);
    for (const record of ctx.warrantyRecords) {
      expect(record.mileageLimit).toBeNull();
      expect(record.startMileage).toBeNull();
      expect(record.expiresAtMileage).toBeNull();
    }
  });
});
