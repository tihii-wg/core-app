import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { applyPrintVariables, applyTemplateVariables } from "./printTemplate";
import {
  emptyPrintContext,
  findUnknownTemplateTokens,
  TEMPLATE_VARIABLES,
  type PrintContext,
} from "./templateVariables";

function orderFixture(partial: Partial<Order> = {}): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "Car",
    vin: "VIN1",
    carNumber: "ABC",
    service: "",
    services: [{ serviceId: "s1", serviceName: "Oil change", price: 100, quantity: 1, discountType: "percent", discountValue: 10 }],
    materials: [{ itemName: "Filter", price: 40, quantity: 2 }],
    description: "Noise",
    status: "in-progress",
    customStatus: { name: "In progress", color: null },
    assignedEmployeeId: "e1",
    assignedEmployeeName: "Bob",
    createdByName: "Ann",
    deadline: "",
    totalPrice: 170,
    discountTotal: 10,
    isPaid: false,
    paymentStatus: "partial",
    taxInvoiceNumber: "TF-9",
    vehicleMileageSnapshot: 12000,
    createdAt: "2026-06-01T10:00:00.000Z",
    closedAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...partial,
  };
}

function fullContext(): PrintContext {
  return emptyPrintContext({
    order: orderFixture({ clientName: '<script>alert(1)</script>' }),
    client: {
      id: "c1",
      name: '<script>alert(1)</script>',
      email: "a@b.c",
      phone: "+373",
      address: "Street 1",
      balance: 0,
      created_at: "",
      client_type: "organization",
      tax_id: "100200",
      contact_person: null,
    },
    vehicle: {
      id: "v1",
      workspaceId: "ws",
      clientId: "c1",
      make: "Toyota",
      model: "Corolla",
      year: 2018,
      vin: "VIN1",
      licensePlate: "ABC",
      initialMileage: 0,
      currentMileage: 15000,
      mileageUnit: "km",
      engineDisplacement: 1.6,
      fuelType: "petrol",
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
    },
    workspace: null,
    legalEntity: {
      id: "le1",
      workspaceId: "ws",
      legalName: "FixFlow SRL",
      address: "Chișinău",
      registrationNumber: "R1",
      taxNumber: "T1",
      billingEmail: "office@fix",
      iban: "MD00",
      bankName: "MAIB",
      bankCode: "",
      additionalInfo: "",
      isDefault: true,
    },
    logoUrl: "https://example.com/logo.webp",
    currency: "MDL",
    locale: "en",
    paymentBalance: {
      total: 170,
      netPaid: 50,
      remaining: 120,
      overpayment: 0,
      status: "partial",
      hasLedger: true,
      isLegacyUnreconciled: false,
    },
    warrantyRecords: [
      {
        id: "w1",
        orderId: "o1",
        itemKind: "service",
        itemName: "Oil change",
        orderServiceId: null,
        orderMaterialId: null,
        durationMonths: 6,
        durationDays: null,
        mileageLimit: 10000,
        startsAt: "2026-06-10T00:00:00.000Z",
        endsOn: "2026-12-10",
        startMileage: 12000,
        expiresAtMileage: 22000,
      },
    ],
    printedAt: new Date("2026-11-06T12:00:00.000Z"),
  });
}

describe("template variable registry", () => {
  it("resolves every token without throwing on a full and empty context", () => {
    const full = fullContext();
    const empty = emptyPrintContext();
    for (const variable of TEMPLATE_VARIABLES) {
      expect(() => variable.resolve(full)).not.toThrow();
      expect(() => variable.resolve(empty)).not.toThrow();
      const emptyValue = variable.resolve(empty);
      if (variable.token === "#ДАТА-ПЕЧАТИ") {
        expect(typeof emptyValue).toBe("string");
      } else {
        expect(emptyValue === null || emptyValue === "" || emptyValue === 0).toBe(true);
      }
    }
  });

  it("escapes user text and builds tables / warranty html", () => {
    const html = applyTemplateVariables(
      "<p>#КЛИЕНТ-ИМЯ</p>#ТАБЛИЦА-УСЛУГ#ТАБЛИЦА-МАТЕРИАЛОВ#ГАРАНТИЯ-СПИСОК#КОМПАНИЯ-ЛОГОТИП",
      fullContext(),
      { currency: "MDL", showCents: true, locale: "en" },
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<table");
    expect(html).toContain("Oil change");
    expect(html).toContain("Filter");
    expect(html).toContain("<ul");
    expect(html).toContain('src="https://example.com/logo.webp"');
  });

  it("replaces longer tokens before shorter prefixes", () => {
    const out = applyTemplateVariables("#ИТОГО-ПРОПИСЬЮ / #ИТОГО", fullContext(), { locale: "en", currency: "MDL" });
    expect(out).not.toContain("#ИТОГО");
    expect(out).toMatch(/lei and/i);
    expect(out).toMatch(/MDL/);
  });

  it("renders #КОМАНДА as comma-separated team names", () => {
    const ctx = fullContext();
    ctx.order = orderFixture({
      team: [
        { employeeId: "e1", name: "Ivan", role: "lead" },
        { employeeId: "e2", name: "Petr", role: "helper" },
      ],
    });
    expect(applyTemplateVariables("#КОМАНДА", ctx, { locale: "en", currency: "MDL" })).toBe("Ivan, Petr");
  });

  it("keeps the original four tokens working via applyPrintVariables", () => {
    const out = applyPrintVariables("<p>#ЗАКАЗ-НОМЕР / #КЛИЕНТ-ИМЯ / #СТАТУС / #ВАЛЮТА / #ДРУГОЕ</p>", {
      orderNumber: "ORD-1",
      clientName: "<b>Ada</b>",
      status: "New",
      currency: "RON",
    });
    expect(out).toBe("<p>ORD-1 / &lt;b&gt;Ada&lt;/b&gt; / New / RON / #ДРУГОЕ</p>");
  });

  it("lists unknown tokens", () => {
    expect(findUnknownTemplateTokens("#ЗАКАЗ-НОМЕР #FOO-BAR #КЛИЕНТ-ИМЯ")).toEqual(["#FOO-BAR"]);
  });

  it("formats money with and without cents", () => {
    const withCents = applyTemplateVariables("#ИТОГО", fullContext(), { currency: "MDL", showCents: true, locale: "en" });
    const noCents = applyTemplateVariables("#ИТОГО", fullContext(), { currency: "MDL", showCents: false, locale: "en" });
    expect(withCents).toMatch(/170/);
    expect(noCents).toMatch(/170/);
  });

  it("formats mileage tokens with the vehicle/order unit", () => {
    const miContext = fullContext();
    miContext.order = orderFixture({
      vehicleMileageSnapshot: 31069,
      vehicleMileageUnitSnapshot: "mi",
    });
    if (miContext.vehicle) miContext.vehicle = { ...miContext.vehicle, mileageUnit: "mi", currentMileage: 31069 };
    const out = applyTemplateVariables("#ЗАКАЗ-ПРОБЕГ / #АВТО-ПРОБЕГ / #ЕДИНИЦА-ПРОБЕГА", miContext, {
      locale: "en",
      currency: "MDL",
    });
    expect(out).toContain("mi");
    expect(out).toMatch(/31[,.]?069/);
    expect(out).toContain("mi");
  });
});
