import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrders, updateOrder, updateOrderStatus } from "../../services/apiOrders";
import { getOrderEvents } from "../../services/apiOrderEvents";
import { issueOrderMaterials, returnOrderMaterials } from "../../services/apiWarehouse";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1, kind: "service" as const };
const labor = { serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 1, kind: "labor" as const };
const freeformPad = {
  itemName: "Custom gasket",
  price: 9,
  quantity: 2,
  supplySource: "one_time" as const,
};

function eventsFor(orderId: string) {
  return fake.all("order_events").filter((event) => event.order_id === orderId);
}

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.owner.id);
});

describe("order activity history", () => {
  it("records service and labor additions with actor identity and frozen snapshots", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "Ada Alpha",
        device: "Golf",
        services: [oilChange, labor],
      },
      WS.A,
    );

    expect(eventsFor(String(created.id)).filter((event) => event.event_type === "order_created")).toHaveLength(1);

    const added = eventsFor(String(created.id)).filter((event) => event.event_type === "service_added");
    expect(added).toHaveLength(2);

    const laborEvent = added.find((event) => (event.payload as { kind?: string }).kind === "labor");
    expect(laborEvent).toMatchObject({
      actor_user_id: USERS.owner.id,
      actor_name: "owner@example.com",
      workspace_id: WS.A,
    });
    expect(laborEvent?.payload).toMatchObject({ item_name: "Brake check", quantity: 1, price: 25, kind: "labor" });
  });

  it("records service removal when a line disappears from the saved set", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "Ada Alpha", device: "Golf", services: [oilChange, labor] },
      WS.A,
    );

    await updateOrder(
      {
        orderId: String(created.id),
        device: "Golf",
        carNumber: "",
        vin: "",
        description: "",
        assignedEmployeeId: "",
        deadline: "",
        services: [oilChange],
      },
      WS.A,
    );

    const removed = eventsFor(String(created.id)).filter((event) => event.event_type === "service_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.payload).toMatchObject({ item_name: "Brake check", price: 25, quantity: 1 });
  });

  it("records exactly one service_removed event per cleared line when all services are removed", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "Ada Alpha", device: "Golf", services: [oilChange, labor] },
      WS.A,
    );
    const orderId = String(created.id);

    await updateOrder(
      {
        orderId,
        device: "Golf",
        carNumber: "",
        vin: "",
        description: "",
        assignedEmployeeId: "",
        deadline: "",
        services: [],
      },
      WS.A,
    );

    const removed = eventsFor(orderId).filter((event) => event.event_type === "service_removed");
    expect(removed).toHaveLength(2);
    const names = removed.map((event) => String((event.payload as { item_name?: string }).item_name ?? "")).sort();
    expect(names).toEqual(["Brake check", "Oil change"]);
    expect(removed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ item_name: "Brake check", price: 25, quantity: 1 }) }),
        expect.objectContaining({ payload: expect.objectContaining({ item_name: "Oil change", price: 40, quantity: 1 }) }),
      ]),
    );
  });

  it("records material add, quantity change, and removal for freeform lines", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "Ada Alpha",
        device: "Golf",
        services: [oilChange],
        materials: [freeformPad],
      },
      WS.A,
    );
    const orderId = String(created.id);
    expect(eventsFor(orderId).some((event) => event.event_type === "material_added")).toBe(true);

    const existing = fake.all("order_materials").find((row) => row.order_id === orderId)!;
    await updateOrder(
      {
        orderId,
        device: "Golf",
        carNumber: "",
        vin: "",
        description: "",
        assignedEmployeeId: "",
        deadline: "",
        services: [oilChange],
        materials: [{ id: String(existing.id), ...freeformPad, quantity: 3 }],
      },
      WS.A,
    );
    expect(eventsFor(orderId).some((event) => event.event_type === "material_updated")).toBe(true);

    await updateOrder(
      {
        orderId,
        device: "Golf",
        carNumber: "",
        vin: "",
        description: "",
        assignedEmployeeId: "",
        deadline: "",
        services: [oilChange],
        materials: [],
      },
      WS.A,
    );
    expect(eventsFor(orderId).some((event) => event.event_type === "material_removed")).toBe(true);
  });

  it("records warehouse issue only after a successful issue, and return only after a successful return", async () => {
    const orderId = "order-a1";
    fake.all("order_materials").push({
      id: "mat-a1",
      order_id: orderId,
      inventory_item_id: "item-a1",
      item_name: "Alpha brake pads",
      price: 12,
      quantity: 2,
      quantity_issued: 0,
      quantity_returned: 0,
      supply_source: "catalog",
      created_at: "2026-02-10T10:00:00.000Z",
    });

    const beforeIssue = eventsFor(orderId).filter((event) => event.event_type === "material_issued").length;
    await expect(issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 99 }], "bad-issue")).rejects.toThrow();
    expect(eventsFor(orderId).filter((event) => event.event_type === "material_issued")).toHaveLength(beforeIssue);

    await issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 1 }], "issue-1");
    expect(eventsFor(orderId).filter((event) => event.event_type === "material_issued")).toHaveLength(beforeIssue + 1);

    await expect(
      returnOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 99 }], "too much", "bad-return"),
    ).rejects.toThrow();
    expect(eventsFor(orderId).filter((event) => event.event_type === "material_returned")).toHaveLength(0);

    await returnOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 1 }], "unused", "return-1");
    expect(eventsFor(orderId).filter((event) => event.event_type === "material_returned")).toHaveLength(1);
  });

  it("does not duplicate warehouse events for an identical idempotent retry", async () => {
    const orderId = "order-a1";
    fake.all("order_materials").push({
      id: "mat-a1",
      order_id: orderId,
      inventory_item_id: "item-a1",
      item_name: "Alpha brake pads",
      price: 12,
      quantity: 2,
      quantity_issued: 0,
      quantity_returned: 0,
      supply_source: "catalog",
      created_at: "2026-02-10T10:00:00.000Z",
    });

    await issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 1 }], "same-key");
    await issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 1 }], "same-key");
    expect(eventsFor(orderId).filter((event) => event.event_type === "material_issued")).toHaveLength(1);
  });

  it("keeps historical material names after the catalog item is renamed", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "Ada Alpha",
        device: "Golf",
        services: [oilChange],
        materials: [freeformPad],
      },
      WS.A,
    );
    const added = eventsFor(String(created.id)).find((event) => event.event_type === "material_added");
    expect((added?.payload as { item_name?: string }).item_name).toBe("Custom gasket");

    // Catalog rename must not rewrite frozen history payloads.
    Object.assign(row("inventory_items", "item-a1")!, { name: "Renamed pads" });
    expect((added?.payload as { item_name?: string }).item_name).toBe("Custom gasket");
  });

  it("isolates events by workspace and keeps status history working", async () => {
    fake.signInAs(USERS.member.id);
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    const listed = await getOrderEvents(WS.A, "order-a1");
    expect(listed.events.some((event) => event.eventType === "status_changed")).toBe(true);
    expect(listed.events[0]?.actorName).toBe("Tom Tech");

    await expect(getOrderEvents(WS.B, "order-a1")).resolves.toMatchObject({ events: [] });
    fake.signInAs(USERS.outsider.id);
    await expect(getOrderEvents(WS.A, "order-a1")).resolves.toMatchObject({ events: [] });
  });

  it("records exactly one status_changed feed event per operational status change", async () => {
    fake.signInAs(USERS.member.id);
    const before = eventsFor("order-a1").filter((event) => event.event_type === "status_changed").length;
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    const afterFirst = eventsFor("order-a1").filter((event) => event.event_type === "status_changed");
    expect(afterFirst.length - before).toBe(1);
    expect(afterFirst[afterFirst.length - 1]).toMatchObject({
      event_type: "status_changed",
      field_name: "status",
      old_value: "new",
      new_value: "in-progress",
    });

    // Idempotent re-submit must not append another history row.
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    expect(eventsFor("order-a1").filter((event) => event.event_type === "status_changed")).toHaveLength(afterFirst.length);
  });

  it("records one payment_recorded event per ledger insert with settlement details", async () => {
    fake.signInAs(USERS.member.id);
    Object.assign(row("orders", "order-a1")!, { total_price: 100, status: "in-progress" });

    const before = eventsFor("order-a1").filter((event) => event.event_type === "payment_recorded").length;

    const first = await fake.client
      .from("payments")
      .insert({
        id: "pay-partial-1",
        workspace_id: WS.A,
        order_id: "order-a1",
        kind: "payment",
        amount: 40,
        currency_code: "EUR",
        payment_method: "cash",
        paid_at: "2026-11-05T12:00:00.000Z",
      })
      .select()
      .single();
    expect(first.error).toBeNull();

    const paymentEvents = eventsFor("order-a1").filter((event) => event.event_type === "payment_recorded");
    expect(paymentEvents.length - before).toBe(1);
    expect(paymentEvents[paymentEvents.length - 1]?.payload).toMatchObject({
      payment_id: "pay-partial-1",
      amount: 40,
      settlement: "partial",
      remaining_after: 60,
      currency_code: "EUR",
      payment_method: "cash",
    });

    const second = await fake.client
      .from("payments")
      .insert({
        id: "pay-balance-1",
        workspace_id: WS.A,
        order_id: "order-a1",
        kind: "payment",
        amount: 60,
        currency_code: "EUR",
        payment_method: "card",
        paid_at: "2026-11-05T13:00:00.000Z",
      })
      .select()
      .single();
    expect(second.error).toBeNull();

    const afterBalance = eventsFor("order-a1").filter((event) => event.event_type === "payment_recorded");
    expect(afterBalance).toHaveLength(paymentEvents.length + 1);
    expect(afterBalance[afterBalance.length - 1]?.payload).toMatchObject({
      payment_id: "pay-balance-1",
      settlement: "balance",
      remaining_after: 0,
    });
  });

  it("rejects direct cancel writes and still records ordinary status changes", async () => {
    Object.assign(row("orders", "order-a1")!, { status: "paid", is_paid: true });
    fake.signInAs(USERS.owner.id);

    await expect(updateOrderStatus("order-a1", "cancelled", WS.A)).rejects.toThrow(/cancel/i);

    await updateOrderStatus("order-a1", "completed", WS.A);
    const refreshed = (await getOrders(WS.A)).find((order) => order.id === "order-a1");
    expect(refreshed?.status).toBe("completed");
    expect(eventsFor("order-a1").some((event) => event.event_type === "status_changed" && event.new_value === "completed")).toBe(true);
  });
});
