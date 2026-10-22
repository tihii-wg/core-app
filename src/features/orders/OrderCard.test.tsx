import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { OrderCard } from "./OrderCard";

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

const longOrder: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Alexandru Constantin Popescu-Mare",
  orderNumber: "ORD-2026-000123",
  device: "Mercedes-Benz Sprinter 316 CDI Extra Long",
  vin: "1HGBH41JXMN109186",
  carNumber: "B123XYZ",
  service: "Oil change",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 1250,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-10-22",
  updatedAt: "2026-10-22",
};

function renderCard(overrides: Partial<Order> = {}) {
  const onView = vi.fn();
  const utils = render(
    <OrderCard
      order={{ ...longOrder, ...overrides }}
      formatMoney={(value) => `MDL ${value.toFixed(2)}`}
      onView={onView}
      onEdit={vi.fn()}
      onStatusChange={vi.fn()}
      onCreateInvoice={vi.fn()}
    />,
  );
  return { onView, ...utils };
}

describe("OrderCard", () => {
  it("shows number, client, vehicle, total, date and both badges with graceful truncation", () => {
    const { container } = renderCard();

    expect(screen.getByText("ORD-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Alexandru Constantin Popescu-Mare")).toBeInTheDocument();
    expect(screen.getByText("Mercedes-Benz Sprinter 316 CDI Extra Long")).toBeInTheDocument();
    expect(screen.getByText("B123XYZ")).toBeInTheDocument();
    expect(screen.getByText("MDL 1250.00")).toBeInTheDocument();
    expect(screen.getByText("2026-10-22")).toBeInTheDocument();
    expect(container.querySelector(".truncate")).not.toBeNull();
  });

  it("falls back to VIN when there is no registration number", () => {
    renderCard({ carNumber: "" });
    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
  });

  it("opens the order from the card surface", async () => {
    const user = userEvent.setup();
    const { onView } = renderCard();

    await user.click(screen.getByText("Alexandru Constantin Popescu-Mare"));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: "order-1" }));
  });

  it("keeps the actions menu independent from the card click, with a 40px touch target", async () => {
    const user = userEvent.setup();
    const { onView } = renderCard();

    const trigger = screen.getByRole("button", { name: "Actions for order ORD-2026-000123" });
    expect(trigger.className).toContain("size-10");

    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "View details" })).toBeInTheDocument();
    expect(onView).not.toHaveBeenCalled();
  });
});
