import { describe, expect, it } from "vitest";
import { mapOrderIndustryFieldsDbError, toOrder } from "./apiOrders";

const baseRow = {
  id: "o1",
  workspace_id: "ws",
  client_id: "c1",
  number: "ORD-1",
  device: "iPhone 14",
  car_number: "",
  vin: "",
  service: "",
  description: "",
  status: "new",
  total_price: 100,
  is_paid: false,
  deadline: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("toOrder industry fields", () => {
  it("round-trips the new industry columns", () => {
    const order = toOrder({
      ...baseRow,
      device_serial: "SN-100",
      device_imei: "356938035643809",
      device_condition: "Scratched",
      device_completeness: "Phone only",
      device_passcode: "secret",
      site_address: "str. Example 1",
      product_dimensions: "2400×720×600",
      measurement_at: "2026-11-10T09:30:00.000Z",
      installation_at: "2026-11-20T14:00:00.000Z",
    });

    expect(order.deviceSerial).toBe("SN-100");
    expect(order.deviceImei).toBe("356938035643809");
    expect(order.deviceCondition).toBe("Scratched");
    expect(order.deviceCompleteness).toBe("Phone only");
    expect(order.devicePasscode).toBe("secret");
    expect(order.siteAddress).toBe("str. Example 1");
    expect(order.productDimensions).toBe("2400×720×600");
    expect(order.measurementAt).toBe("2026-11-10T09:30:00.000Z");
    expect(order.installationAt).toBe("2026-11-20T14:00:00.000Z");
  });

  it("defaults missing industry columns to empty / null", () => {
    const order = toOrder({ ...baseRow });
    expect(order.deviceSerial).toBe("");
    expect(order.deviceImei).toBe("");
    expect(order.deviceCondition).toBe("");
    expect(order.deviceCompleteness).toBe("");
    expect(order.devicePasscode).toBe("");
    expect(order.siteAddress).toBe("");
    expect(order.productDimensions).toBe("");
    expect(order.measurementAt).toBeNull();
    expect(order.installationAt).toBeNull();
  });
});

describe("mapOrderIndustryFieldsDbError", () => {
  it("maps the install-after-measure check to friendly copy", () => {
    expect(mapOrderIndustryFieldsDbError({ message: 'new row violates check constraint "orders_install_after_measure"' })?.message).toBe(
      "Installation must be on or after the measurement date and time.",
    );
  });

  it("returns null for unrelated errors", () => {
    expect(mapOrderIndustryFieldsDbError({ message: "other" })).toBeNull();
  });
});
