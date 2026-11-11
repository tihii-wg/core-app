import { describe, expect, it } from "vitest";
import type { Order, OrderService } from "../../lib/types";
import {
  buildOrderAlerts,
  hasAtLeastOneServiceAssignee,
  hasOrderLevelAssignee,
  isOrderUnassignedForAlert,
  orderHasAnyAssignee,
  undismissedAlerts,
} from "./orderAlerts";

function service(partial: Partial<OrderService> = {}): OrderService {
  return {
    serviceId: "svc-1",
    serviceName: "Oil",
    price: 10,
    quantity: 1,
    technicianId: null,
    ...partial,
  };
}

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

describe("order assignee helpers", () => {
  it("detects order-level and service-level assignees independently", () => {
    expect(hasOrderLevelAssignee({ assignedEmployeeId: "" })).toBe(false);
    expect(hasOrderLevelAssignee({ assignedEmployeeId: "emp-1" })).toBe(true);

    expect(hasAtLeastOneServiceAssignee({ services: [] })).toBe(false);
    expect(hasAtLeastOneServiceAssignee({ services: [service({ technicianId: null })] })).toBe(false);
    expect(
      hasAtLeastOneServiceAssignee({
        services: [service({ technicianId: null }), service({ technicianId: "emp-2", serviceId: "svc-2" })],
      }),
    ).toBe(true);
  });

  it("matches the business table for shouldShowUnassignedNotification", () => {
    const cases: Array<{
      label: string;
      assignedEmployeeId: string;
      services: OrderService[];
      show: boolean;
    }> = [
      { label: "none / none", assignedEmployeeId: "", services: [], show: true },
      { label: "assigned / none", assignedEmployeeId: "emp-1", services: [], show: false },
      {
        label: "none / at least one service",
        assignedEmployeeId: "",
        services: [service({ technicianId: "emp-2" }), service({ technicianId: null, serviceId: "svc-2" })],
        show: false,
      },
      {
        label: "none / all services assigned",
        assignedEmployeeId: "",
        services: [service({ technicianId: "emp-2" }), service({ technicianId: "emp-3", serviceId: "svc-2" })],
        show: false,
      },
      {
        label: "assigned / services assigned",
        assignedEmployeeId: "emp-1",
        services: [service({ technicianId: "emp-2" })],
        show: false,
      },
      {
        label: "none / some services assigned",
        assignedEmployeeId: "",
        services: [service({ technicianId: "emp-2" }), service({ technicianId: "", serviceId: "svc-2" })],
        show: false,
      },
    ];

    for (const row of cases) {
      const sample = { assignedEmployeeId: row.assignedEmployeeId, services: row.services };
      expect(isOrderUnassignedForAlert(sample), row.label).toBe(row.show);
      expect(orderHasAnyAssignee(sample), row.label).toBe(!row.show);
    }
  });
});

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

  it("does not treat an order as unassigned when only a service has a technician", () => {
    const alerts = buildOrderAlerts(
      [
        order({
          id: "svc-only",
          orderNumber: "ORD-SVC",
          assignedEmployeeId: "",
          assignedEmployeeName: "",
          deadline: "",
          status: "new",
          services: [
            service({ technicianId: null }),
            service({ serviceId: "svc-2", technicianId: "emp-line" }),
          ],
        }),
      ],
      today,
    );

    expect(alerts).toEqual([]);
  });

  it("does not treat an order as unassigned when only the general assignee is set", () => {
    const alerts = buildOrderAlerts(
      [
        order({
          id: "order-only",
          orderNumber: "ORD-GEN",
          assignedEmployeeId: "emp-1",
          assignedEmployeeName: "Tech",
          deadline: "",
          status: "new",
          services: [service({ technicianId: null }), service({ serviceId: "svc-2", technicianId: null })],
        }),
      ],
      today,
    );

    expect(alerts).toEqual([]);
  });

  it("shows unassigned when neither order nor any service has an employee", () => {
    const alerts = buildOrderAlerts(
      [
        order({
          id: "free",
          orderNumber: "ORD-FREE",
          assignedEmployeeId: "",
          assignedEmployeeName: "",
          deadline: "2026-11-01",
          status: "new",
          services: [service({ technicianId: null }), service({ serviceId: "svc-2", technicianId: "  " })],
        }),
      ],
      today,
    );

    expect(alerts.map((alert) => alert.id)).toEqual(["unassigned:free"]);
  });

  it("suppresses unassigned when multiple services exist and only one has a technician", () => {
    const alerts = buildOrderAlerts(
      [
        order({
          id: "one-line",
          orderNumber: "ORD-ONE",
          assignedEmployeeId: "",
          assignedEmployeeName: "",
          deadline: "",
          status: "in-progress",
          services: [
            service({ technicianId: "emp-2" }),
            service({ serviceId: "svc-2", technicianId: null }),
            service({ serviceId: "svc-3", technicianId: null }),
          ],
        }),
      ],
      today,
    );

    expect(alerts).toEqual([]);
  });

  it("recalculates when the last assignee is removed and when any assignee is added", () => {
    let current = order({
      id: "live",
      orderNumber: "ORD-LIVE",
      assignedEmployeeId: "",
      assignedEmployeeName: "",
      deadline: "",
      status: "new",
      services: [service({ technicianId: "emp-2" }), service({ serviceId: "svc-2", technicianId: null })],
    });

    expect(buildOrderAlerts([current], today).map((alert) => alert.kind)).toEqual([]);

    // Remove the last service assignee → notification appears.
    current = {
      ...current,
      services: [service({ technicianId: null }), service({ serviceId: "svc-2", technicianId: null })],
    };
    expect(buildOrderAlerts([current], today).map((alert) => alert.id)).toEqual(["unassigned:live"]);

    // Assign a service technician → notification suppressed (no page reload; new order snapshot).
    current = {
      ...current,
      services: [service({ technicianId: "emp-9" }), service({ serviceId: "svc-2", technicianId: null })],
    };
    expect(buildOrderAlerts([current], today)).toEqual([]);

    // Clear service tech, set general assignee → still suppressed.
    current = {
      ...current,
      assignedEmployeeId: "emp-1",
      assignedEmployeeName: "Tech",
      services: [service({ technicianId: null }), service({ serviceId: "svc-2", technicianId: null })],
    };
    expect(buildOrderAlerts([current], today)).toEqual([]);

    // Clear general assignee again → notification returns.
    current = { ...current, assignedEmployeeId: "", assignedEmployeeName: "" };
    expect(buildOrderAlerts([current], today).map((alert) => alert.id)).toEqual(["unassigned:live"]);
  });

  it("does not count team membership as an assignee for this alert", () => {
    const alerts = buildOrderAlerts(
      [
        order({
          id: "team-only",
          orderNumber: "ORD-TEAM",
          assignedEmployeeId: "",
          assignedEmployeeName: "",
          deadline: "",
          status: "new",
          team: [{ employeeId: "emp-team", role: "helper", name: "Helper" }],
          services: [service({ technicianId: null })],
        }),
      ],
      today,
    );

    expect(alerts.map((alert) => alert.id)).toEqual(["unassigned:team-only"]);
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
