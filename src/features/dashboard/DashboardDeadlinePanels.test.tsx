import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { DashboardDeadlinePanels } from "./DashboardDeadlinePanels";

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

function order(partial: Partial<Order>): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    clientName: "Ada Lovelace",
    orderNumber: "ORD-2026-001",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil",
    services: [],
    description: "",
    status: "in-progress",
    assignedEmployeeId: "emp-1",
    assignedEmployeeName: "Ada Tech",
    deadline: "2026-10-01",
    totalPrice: 40,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
    ...partial,
  };
}

describe("DashboardDeadlinePanels", () => {
  it("shows empty states when nothing is overdue or upcoming", () => {
    renderWithQuery(
      <DashboardDeadlinePanels
        orders={[order({ deadline: "2026-11-01", status: "new" })]}
        today="2026-10-10"
        onOpenOrder={vi.fn()}
      />,
    );

    expect(screen.getByText("No overdue orders")).toBeInTheDocument();
    expect(screen.getByText("No upcoming deadlines")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("shows overdue and upcoming counts with useful order details", () => {
    renderWithQuery(
      <DashboardDeadlinePanels
        orders={[
          order({ id: "overdue-1", orderNumber: "ORD-OVER", deadline: "2026-10-01", status: "waiting-parts", assignedEmployeeName: "" }),
          order({ id: "upcoming-1", orderNumber: "ORD-SOON", clientName: "Bob Client", deadline: "2026-10-12", status: "new", assignedEmployeeName: "Bob Tech" }),
          order({ id: "closed", orderNumber: "ORD-DONE", deadline: "2026-10-01", status: "completed" }),
        ]}
        today="2026-10-10"
        onOpenOrder={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Overdue orders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upcoming deadlines" })).toBeInTheDocument();
    expect(screen.getByText("ORD-OVER")).toBeInTheDocument();
    expect(screen.getByText("ORD-SOON")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Bob Client")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument();
    expect(screen.getByText("2026-10-12")).toBeInTheDocument();
    expect(screen.getByText(/Unassigned/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Tech/)).toBeInTheDocument();
    expect(screen.queryByText("ORD-DONE")).not.toBeInTheDocument();
  });

  it("opens an order from the overdue list", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    const overdue = order({ id: "overdue-1", orderNumber: "ORD-OVER", deadline: "2026-10-01" });

    renderWithQuery(<DashboardDeadlinePanels orders={[overdue]} today="2026-10-10" onOpenOrder={onOpenOrder} />);

    await user.click(screen.getByRole("button", { name: /ORD-OVER/ }));

    expect(onOpenOrder).toHaveBeenCalledExactlyOnceWith(overdue);
  });
});
