import { describe, expect, it } from "vitest";
import { toOrder } from "./apiOrders";

/**
 * Orders list rows render denormalized `orders.device` / `car_number` (not a vehicles join).
 * Create-from-vehicle must persist those snapshot columns alongside `vehicle_id`.
 */
describe("toOrder vehicle list snapshot", () => {
  const baseRow = {
    id: "order-draft-1",
    workspace_id: "ws-1",
    client_id: "client-1",
    number: "ORD-2026-000001",
    service: "",
    description: "",
    status: "new",
    total_price: 0,
    is_paid: false,
    deadline: null,
    created_at: "2026-11-11T10:00:00.000Z",
    updated_at: "2026-11-11T10:00:00.000Z",
  };

  it("maps vehicle_id with device make/model and plate for the Orders list", () => {
    const order = toOrder({
      ...baseRow,
      vehicle_id: "veh-a",
      device: "Toyota Corolla 2018",
      car_number: "AAA111",
      vin: "VIN-A",
    });

    expect(order.vehicleId).toBe("veh-a");
    expect(order.device).toBe("Toyota Corolla 2018");
    expect(order.carNumber).toBe("AAA111");
    expect(order.vin).toBe("VIN-A");
    expect(order.status).toBe("new");
  });

  it("keeps an empty vehicle snapshot when vehicle_id is null", () => {
    const order = toOrder({
      ...baseRow,
      vehicle_id: null,
      device: null,
      car_number: null,
      vin: null,
    });

    expect(order.vehicleId).toBeNull();
    expect(order.device).toBe("");
    expect(order.carNumber).toBe("");
    expect(order.vin).toBe("");
  });

  it("does not borrow another row's vehicle fields", () => {
    const a = toOrder({
      ...baseRow,
      id: "order-a",
      vehicle_id: "veh-a",
      device: "BMW X5",
      car_number: "B111BMW",
      vin: "",
    });
    const b = toOrder({
      ...baseRow,
      id: "order-b",
      vehicle_id: "veh-b",
      device: "VW Golf 2020",
      car_number: "BBB222",
      vin: "VIN-B",
    });

    expect(a.device).toBe("BMW X5");
    expect(a.carNumber).toBe("B111BMW");
    expect(b.device).toBe("VW Golf 2020");
    expect(b.carNumber).toBe("BBB222");
    expect(a.vehicleId).not.toBe(b.vehicleId);
  });
});
