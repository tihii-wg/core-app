import { describe, expect, it } from "vitest";
import { assertMinPaidOrExplain, mapMinPaidStatusError, minPaidMessage } from "./minPaidStatusGuard";

const ruTemplate = "Для статуса «{{status}}» нужна оплата не меньше {{percent}}% ({{required}}). Оплачено {{paid}}.";

// Minimal i18n double: interpolates {{vars}} into the ru message.
const t = (_key: never, options?: never) => {
  const vars = (options ?? {}) as Record<string, string>;
  return ruTemplate.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) => vars[name] ?? "");
};

const formatMoney = (amount: number) => `${amount.toLocaleString("en-US").replace(/,/g, " ")} MDL`;

describe("assertMinPaidOrExplain", () => {
  const order = { totalPrice: 33140 };

  it("returns null when the target has no requirement", () => {
    expect(
      assertMinPaidOrExplain({ order, targetDefinition: { name: "Новый", minPaidPercent: null }, netPaid: 0, formatMoney, t }),
    ).toBeNull();
    expect(assertMinPaidOrExplain({ order, targetDefinition: null, netPaid: 0, formatMoney, t })).toBeNull();
    expect(assertMinPaidOrExplain({ order, targetDefinition: undefined, netPaid: 0, formatMoney, t })).toBeNull();
  });

  it("returns null when enough has been paid", () => {
    const definition = { name: "В производстве", minPaidPercent: 50 };
    expect(assertMinPaidOrExplain({ order, targetDefinition: definition, netPaid: 16570, formatMoney, t })).toBeNull();
    expect(assertMinPaidOrExplain({ order, targetDefinition: definition, netPaid: 20000, formatMoney, t })).toBeNull();
  });

  it("returns null for zero-total orders", () => {
    expect(
      assertMinPaidOrExplain({
        order: { totalPrice: 0 },
        targetDefinition: { name: "В производстве", minPaidPercent: 50 },
        netPaid: 0,
        formatMoney,
        t,
      }),
    ).toBeNull();
  });

  it("explains the block with the localized message and numbers", () => {
    const block = assertMinPaidOrExplain({
      order,
      targetDefinition: { name: "В производстве", minPaidPercent: 50 },
      netPaid: 0,
      formatMoney,
      t,
    });
    expect(block).toEqual({
      message: "Для статуса «В производстве» нужна оплата не меньше 50% (16 570 MDL). Оплачено 0 MDL.",
      required: 16570,
      paid: 0,
      percent: 50,
      statusName: "В производстве",
    });
  });

  it("blocks when paid is just under the requirement", () => {
    const block = assertMinPaidOrExplain({
      order,
      targetDefinition: { name: "В производстве", minPaidPercent: 50 },
      netPaid: 16000,
      formatMoney,
      t,
    });
    expect(block?.paid).toBe(16000);
    expect(block?.required).toBe(16570);
  });
});

describe("mapMinPaidStatusError", () => {
  const dbMessage = "order_status:min_paid_required status=В производстве percent=50 required=16570.00 paid=0.00";

  it("maps the DB error to the same localized message", () => {
    expect(mapMinPaidStatusError(dbMessage, { formatMoney, t })).toBe(
      "Для статуса «В производстве» нужна оплата не меньше 50% (16 570 MDL). Оплачено 0 MDL.",
    );
  });

  it("returns null for unrelated or empty messages", () => {
    expect(mapMinPaidStatusError("permission denied", { formatMoney, t })).toBeNull();
    expect(mapMinPaidStatusError(null, { formatMoney, t })).toBeNull();
    expect(mapMinPaidStatusError("", { formatMoney, t })).toBeNull();
  });
});

describe("minPaidMessage", () => {
  it("trims fractional percents", () => {
    const message = minPaidMessage({ statusName: "X", percent: 33.5, required: 10, paid: 0 }, formatMoney, t);
    expect(message).toContain("33.5%");
  });
});
