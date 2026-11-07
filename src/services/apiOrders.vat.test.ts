import { describe, expect, it } from "vitest";
import { toOrder } from "./apiOrders";

const baseRow = {
  id: "o1",
  workspace_id: "ws",
  client_id: "c1",
  number: "ORD-1",
  device: "",
  car_number: "",
  vin: "",
  service: "",
  description: "",
  status: "new",
  total_price: 1200,
  is_paid: false,
  deadline: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("toOrder VAT columns", () => {
  it("maps vat_rate and tax_total when present", () => {
    const order = toOrder({ ...baseRow, vat_rate: 20, tax_total: 200 });
    expect(order.vatRate).toBe(20);
    expect(order.taxTotal).toBe(200);
  });

  it("treats missing VAT columns as null (pre-migration / select * without columns)", () => {
    const order = toOrder({ ...baseRow });
    expect(order.vatRate).toBeNull();
    expect(order.taxTotal).toBeNull();
  });

  it("treats invalid or non-positive vat_rate as null", () => {
    expect(toOrder({ ...baseRow, vat_rate: 0 }).vatRate).toBeNull();
    expect(toOrder({ ...baseRow, vat_rate: "x" }).vatRate).toBeNull();
  });
});
