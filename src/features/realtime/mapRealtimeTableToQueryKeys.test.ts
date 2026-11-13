import { describe, expect, it } from "vitest";
import { isOrderEditRelevantTable, mapRealtimeTableToQueryKeys } from "./mapRealtimeTableToQueryKeys";

describe("mapRealtimeTableToQueryKeys", () => {
  it("maps orders family like useDeleteOrder", () => {
    expect(mapRealtimeTableToQueryKeys("orders", "ws-1")).toEqual([
      ["orders", "ws-1"],
      ["orders-page", "ws-1"],
      ["order_events", "ws-1"],
      ["clients", "ws-1"],
      ["inventory", "ws-1"],
      ["inventory-movements", "ws-1"],
      ["warehouse-stock", "ws-1"],
      ["dashboard", "ws-1"],
      ["orders-warranty-indicators", "ws-1"],
      ["warranty-records", "ws-1"],
    ]);
    expect(mapRealtimeTableToQueryKeys("order_employees", "ws-1")).toEqual(
      mapRealtimeTableToQueryKeys("orders", "ws-1"),
    );
  });

  it("maps payments family like invalidatePaymentViews", () => {
    expect(mapRealtimeTableToQueryKeys("payments", "ws-1")).toEqual([
      ["payments", "ws-1"],
      ["orders", "ws-1"],
      ["invoices", "ws-1"],
      ["expenses", "ws-1"],
      ["finance-accounts", "ws-1"],
      ["order_events", "ws-1"],
    ]);
    expect(mapRealtimeTableToQueryKeys("invoices", "ws-1")).toEqual(
      mapRealtimeTableToQueryKeys("payments", "ws-1"),
    );
  });

  it("maps clients and inventory tables", () => {
    expect(mapRealtimeTableToQueryKeys("clients", "ws-1")).toEqual([["clients", "ws-1"]]);
    expect(mapRealtimeTableToQueryKeys("inventory_items", "ws-1")).toEqual([
      ["inventory", "ws-1"],
      ["inventory-movements", "ws-1"],
      ["warehouse-stock", "ws-1"],
    ]);
  });

  it("returns empty for unknown / unsubscribed line tables", () => {
    expect(mapRealtimeTableToQueryKeys("order_services", "ws-1")).toEqual([]);
    expect(mapRealtimeTableToQueryKeys("order_materials", "ws-1")).toEqual([]);
    expect(mapRealtimeTableToQueryKeys("secrets", "ws-1")).toEqual([]);
  });

  it("flags order-edit-relevant tables", () => {
    expect(isOrderEditRelevantTable("orders")).toBe(true);
    expect(isOrderEditRelevantTable("payments")).toBe(true);
    expect(isOrderEditRelevantTable("clients")).toBe(false);
  });
});
