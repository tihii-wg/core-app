import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { buildOrderAlerts, undismissedAlerts } from "./orderAlerts";

function order(partial: Partial<Order>): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil",
    services: [],
    description: "",
    status: "in-progress",
    assignedEmployeeId: "emp-1",
    assignedEmployeeName: "Tech",
    deadline: "2026-10-10",
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...partial,
  };
}

const today = "2026-10-10";

describe("buildOrderAlerts", () => {
  it("returns an empty list when there is nothing actionable", () => {
    expect(
      buildOrderAlerts(
        [order({ status: "completed", deadline: "2026-10-01" }), order({ status: "new", deadline: "2026-11-01", assignedEmployeeId: "emp-1" })],
        today,
      ),
    ).toEqual([]);
  });

  it("prioritizes overdue over upcoming and unassigned for the same order", () => {
    const overdueUnassigned = order({
      id: "overdue-u",
      orderNumber: "ORD-OVER",
      deadline: "2026-10-01",
      assignedEmployeeId: "",
      assignedEmployeeName: "",
      status: "waiting-parts",
    });

    expect(buildOrderAlerts([overdueUnassigned], today)).toEqual([
      {
        id: "overdue:overdue-u",
        kind: "overdue",
        orderId: "overdue-u",
        orderNumber: "ORD-OVER",
        clientName: "Ada",
        deadline: "2026-10-01",
      },
    ]);
  });

  it("lists overdue, upcoming, then unassigned without duplicates", () => {
    const alerts = buildOrderAlerts(
      [
        order({ id: "u1", orderNumber: "ORD-U1", assignedEmployeeId: "", assignedEmployeeName: "", deadline: "2026-11-01", status: "new" }),
        order({ id: "over1", orderNumber: "ORD-O1", deadline: "2026-10-01", status: "in-progress" }),
        order({ id: "up1", orderNumber: "ORD-UP", deadline: "2026-10-12", status: "new" }),
        order({ id: "closed", orderNumber: "ORD-DONE", deadline: "2026-10-01", status: "completed", assignedEmployeeId: "" }),
        order({ id: "u2", orderNumber: "ORD-U2", assignedEmployeeId: "", assignedEmployeeName: "", deadline: "", status: "waiting-parts" }),
      ],
      today,
    );

    expect(alerts.map((alert) => alert.id)).toEqual(["overdue:over1", "upcoming:up1", "unassigned:u1", "unassigned:u2"]);
  });

  it("produces stable ids so the same order state does not create new alert identities", () => {
    const orders = [order({ id: "over1", deadline: "2026-10-01" })];
    const first = buildOrderAlerts(orders, today);
    const second = buildOrderAlerts(orders, today);
    expect(first).toEqual(second);
    expect(first[0]?.id).toBe("overdue:over1");
  });

  it("respects the limit after prioritization", () => {
    const orders = Array.from({ length: 5 }, (_, index) =>
      order({ id: `o${index}`, orderNumber: `ORD-${index}`, deadline: "2026-10-01", status: "new" }),
    );
    expect(buildOrderAlerts(orders, today, 2)).toHaveLength(2);
  });
});

describe("undismissedAlerts", () => {
  it("filters session-dismissed alert ids", () => {
    const alerts = buildOrderAlerts(
      [
        order({ id: "a", deadline: "2026-10-01" }),
        order({ id: "b", deadline: "2026-10-12" }),
      ],
      today,
    );

    expect(undismissedAlerts(alerts, new Set(["overdue:a"])).map((alert) => alert.id)).toEqual(["upcoming:b"]);
  });
});
