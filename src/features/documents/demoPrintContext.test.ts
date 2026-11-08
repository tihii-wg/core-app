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

  it("resolves payment-stage tokens from the furniture demo schedule (50/30/20 of 33140)", () => {
    const ctx = demoPrintContext({
      documentType: "invoice",
      locale: "ru",
      currency: "MDL",
      industrySlug: "furniture_manufacturing",
      now: new Date("2026-11-07T12:00:00.000Z"),
    });
    expect(ctx.paymentBalance?.total).toBe(33140);
    const stages = ctx.paymentStages ?? [];
    expect(stages.map((stage) => stage.due)).toEqual([16570, 9942, 6628]);
    expect(stages.map((stage) => stage.paid)).toEqual([16570, 0, 0]);

    const opts = { locale: "ru", currency: "MDL", showCents: false } as const;
    const schedule = applyTemplateVariables("#ГРАФИК-ОПЛАТ", ctx, opts);
    expect(schedule).toContain("<table");
    for (const amount of ["16\u00a0570", "9\u00a0942", "6\u00a0628"]) {
      expect(schedule.replace(/[\u202f\s]/g, "\u00a0")).toContain(amount);
    }
    expect(applyTemplateVariables("#ЭТАП-ТЕКУЩИЙ", ctx, opts)).toBe("Изготовление");
    expect(applyTemplateVariables("#ЭТАП-ТЕКУЩИЙ-СУММА", ctx, opts).replace(/[\u202f\s]/g, "")).toBe("MDL9942");
    // Longer token must not be eaten by its prefix.
    expect(applyTemplateVariables("#ЭТАП-ТЕКУЩИЙ-СУММА / #ЭТАП-ТЕКУЩИЙ", ctx, opts)).not.toContain("#");
  });
});
