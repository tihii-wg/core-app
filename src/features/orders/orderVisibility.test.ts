import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { addCalendarDays, isOrderOverdue, isOrderUpcoming, listOverdueOrders, listUpcomingOrders, matchesDeadlineFilter } from "./orderVisibility";

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
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "2026-10-10",
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...partial,
  };
}

describe("orderVisibility", () => {
  it("adds calendar days across month boundaries", () => {
    expect(addCalendarDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("treats open orders past their deadline as overdue", () => {
    expect(isOrderOverdue(order({ deadline: "2026-10-09", status: "in-progress" }), "2026-10-10")).toBe(true);
    expect(isOrderOverdue(order({ deadline: "2026-10-10", status: "in-progress" }), "2026-10-10")).toBe(false);
    expect(isOrderOverdue(order({ deadline: "2026-10-09", status: "completed" }), "2026-10-10")).toBe(false);
    expect(isOrderOverdue(order({ deadline: "", status: "new" }), "2026-10-10")).toBe(false);
  });

  it("treats open orders due today or within 7 days as upcoming", () => {
    expect(isOrderUpcoming(order({ deadline: "2026-10-10", status: "new" }), "2026-10-10")).toBe(true);
    expect(isOrderUpcoming(order({ deadline: "2026-10-17", status: "waiting-parts" }), "2026-10-10")).toBe(true);
    expect(isOrderUpcoming(order({ deadline: "2026-10-18", status: "new" }), "2026-10-10")).toBe(false);
    expect(isOrderUpcoming(order({ deadline: "2026-10-09", status: "new" }), "2026-10-10")).toBe(false);
    expect(isOrderUpcoming(order({ deadline: "2026-10-12", status: "paid" }), "2026-10-10")).toBe(false);
  });

  it("matches deadline filter values", () => {
    const overdue = order({ deadline: "2026-10-01", status: "in-progress" });
    const upcoming = order({ deadline: "2026-10-12", status: "waiting-parts" });
    expect(matchesDeadlineFilter(overdue, "overdue", "2026-10-10")).toBe(true);
    expect(matchesDeadlineFilter(upcoming, "upcoming", "2026-10-10")).toBe(true);
    expect(matchesDeadlineFilter(overdue, "upcoming", "2026-10-10")).toBe(false);
    expect(matchesDeadlineFilter(upcoming, "all", "2026-10-10")).toBe(true);
  });

  it("lists overdue and upcoming orders by earliest deadline", () => {
    const olderOverdue = order({ id: "o-old", deadline: "2026-09-01", status: "in-progress" });
    const newerOverdue = order({ id: "o-new", deadline: "2026-10-01", status: "waiting-parts" });
    const soon = order({ id: "o-soon", deadline: "2026-10-12", status: "new" });
    const later = order({ id: "o-later", deadline: "2026-10-16", status: "new" });
    const closed = order({ id: "o-closed", deadline: "2026-09-01", status: "completed" });
    const far = order({ id: "o-far", deadline: "2026-11-01", status: "new" });

    expect(listOverdueOrders([newerOverdue, closed, olderOverdue], "2026-10-10").map((item) => item.id)).toEqual(["o-old", "o-new"]);
    expect(listUpcomingOrders([later, far, soon], "2026-10-10").map((item) => item.id)).toEqual(["o-soon", "o-later"]);
  });
});
