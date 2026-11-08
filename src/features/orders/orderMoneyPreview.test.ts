import { describe, expect, it } from "vitest";
import { previewOrderMoney } from "./orderMoneyPreview";

describe("previewOrderMoney decimal quantities", () => {
  it("matches DB line total round(price * qty, 2) for 2.5 × 450", () => {
    const money = previewOrderMoney([], [{ price: 450, quantity: 2.5 }], []);
    expect(money.subtotal).toBe(1125);
    expect(money.total).toBe(1125);
  });

  it("accepts comma-string material quantities via the shared parser", () => {
    const money = previewOrderMoney([], [{ price: 100, quantity: "2,5" as unknown as number }], []);
    expect(money.subtotal).toBe(250);
  });
});
