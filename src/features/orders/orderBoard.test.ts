import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import { buildOrderBoardColumns, resolveBoardMove } from "./orderBoard";

function order(partial: Partial<Order> & { id: string }): Order {
  return {
    clientId: "c1",
    clientName: "Client",
    orderNumber: partial.id,
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function definition(partial: Partial<StatusDefinition> & { id: string; name: string }): StatusDefinition {
  return {
    workspaceId: "ws",
    entity: "order",
    color: null,
    statusGroup: "new",
    systemStatus: null,
    code: null,
    semanticAction: "normal",
    sortOrder: 0,
    isDefault: false,
    isActive: true,
    showOverdueBadge: false,
    addsToBackorders: false,
    ...partial,
  };
}

describe("buildOrderBoardColumns", () => {
  it("falls back to the system status columns without definitions", () => {
    const columns = buildOrderBoardColumns([order({ id: "a", status: "paid" }), order({ id: "b" })], []);
    expect(columns.map((column) => column.key)).toEqual([
      "system:new",
      "system:in-progress",
      "system:waiting-parts",
      "system:completed",
      "system:paid",
      "system:cancelled",
      "system:closed",
    ]);
    expect(columns.find((column) => column.key === "system:paid")?.orders.map((o) => o.id)).toEqual(["a"]);
  });

  it("uses custom columns ordered by group, places orders by custom id or system status", () => {
    const definitions = [
      definition({ id: "done", name: "Ready", statusGroup: "done", systemStatus: "completed", sortOrder: 1 }),
      definition({ id: "new", name: "New", statusGroup: "new", systemStatus: "new", sortOrder: 5 }),
      definition({ id: "wait", name: "Waiting", statusGroup: "pending", systemStatus: "in-progress", sortOrder: 2 }),
      definition({ id: "off", name: "Hidden", isActive: false }),
    ];
    const columns = buildOrderBoardColumns(
      [
        order({ id: "1", status: "new" }),
        order({ id: "2", status: "in-progress", customStatusId: "wait" }),
        order({ id: "3", status: "waiting-parts" }),
      ],
      definitions,
    );

    expect(columns.map((column) => column.key)).toEqual(["unassigned", "new", "wait", "done"]);
    expect(columns[0].orders.map((o) => o.id)).toEqual(["3"]);
    expect(columns[1].orders.map((o) => o.id)).toEqual(["1"]);
    expect(columns[2].orders.map((o) => o.id)).toEqual(["2"]);
  });

  it("places cancelled orders on the cancel column even with a stale ordinary custom_status_id", () => {
    const definitions = [
      definition({ id: "progress", name: "In Progress", statusGroup: "in_progress", systemStatus: "in-progress", sortOrder: 1 }),
      definition({
        id: "cancel",
        name: "Cancelled",
        statusGroup: "dropped_off",
        systemStatus: "cancelled",
        semanticAction: "cancel",
        sortOrder: 2,
      }),
    ];
    const columns = buildOrderBoardColumns(
      [order({ id: "1", status: "cancelled", customStatusId: "progress" })],
      definitions,
    );
    expect(columns.find((column) => column.key === "cancel")?.orders.map((o) => o.id)).toEqual(["1"]);
    expect(columns.find((column) => column.key === "progress")?.orders).toEqual([]);
  });
});

describe("resolveBoardMove", () => {
  const paid = buildOrderBoardColumns([], []).find((column) => column.key === "system:paid")!;

  it("moves to a system column and clears the custom status", () => {
    expect(resolveBoardMove(order({ id: "1", status: "new", customStatusId: "x" }), paid)).toEqual({ status: "paid", customStatusId: null });
  });

  it("is a no-op when already in the system column", () => {
    expect(resolveBoardMove(order({ id: "1", status: "paid" }), paid)).toBeNull();
  });

  it("sets system_status from a custom column and refuses unassigned", () => {
    const columns = buildOrderBoardColumns(
      [order({ id: "1", status: "waiting-parts" })],
      [definition({ id: "ready", name: "Ready", statusGroup: "done", systemStatus: "completed" })],
    );
    const ready = columns.find((column) => column.key === "ready")!;
    const unassigned = columns.find((column) => column.key === "unassigned")!;
    const o = order({ id: "1", status: "waiting-parts" });
    expect(resolveBoardMove(o, ready)).toEqual({ status: "completed", customStatusId: "ready" });
    expect(resolveBoardMove(o, unassigned)).toBeNull();
  });

  it("refuses drag onto close/cancel semantic columns even if named Closed", () => {
    const columns = buildOrderBoardColumns(
      [order({ id: "1", status: "new" })],
      [
        definition({ id: "close", name: "Закрыт", statusGroup: "closed", semanticAction: "close", systemStatus: "closed" }),
        definition({ id: "fake", name: "Закрыт", statusGroup: "done", semanticAction: "normal", systemStatus: "completed" }),
      ],
    );
    const closeCol = columns.find((column) => column.key === "close")!;
    const fakeCol = columns.find((column) => column.key === "fake")!;
    const o = order({ id: "1", status: "new" });
    expect(resolveBoardMove(o, closeCol)).toBeNull();
    expect(resolveBoardMove(o, fakeCol)).toEqual({ status: "completed", customStatusId: "fake" });
  });
});
