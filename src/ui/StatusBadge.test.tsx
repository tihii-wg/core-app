import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderStatusBadge, StatusBadge } from "./StatusBadge";

vi.mock("../features/industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({ workflow: { orderStatuses: ["new", "in-progress", "completed", "paid", "cancelled"] } }),
}));

vi.mock("../features/industries/industryWorkflow", () => ({
  industryOrderStatusLabel: (_workflow: unknown, status: string) => `system:${status}`,
}));

describe("StatusBadge", () => {
  it("allows long localized labels to wrap within a narrow container", () => {
    const { container } = render(
      <div className="w-40 overflow-hidden">
        <StatusBadge variant="warning">Старое (несверено)</StatusBadge>
      </div>,
    );

    const badge = screen.getByText("Старое (несверено)");
    expect(badge.className).toMatch(/max-w-full/);
    expect(badge.className).toMatch(/min-w-0/);
    expect(badge.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(badge.className).not.toMatch(/whitespace-nowrap/);
    expect(badge.className).not.toMatch(/\bshrink-0\b/);
    expect(badge.className).toMatch(/min-h-5\.5/);
    expect(container.firstElementChild?.contains(badge)).toBe(true);
  });
});

describe("OrderStatusBadge", () => {
  it("prefers the persisted custom status name and color over the legacy system label", () => {
    render(<OrderStatusBadge status="in-progress" customStatus={{ name: "In workshop", color: "#336699" }} />);
    expect(screen.getByText("In workshop")).toBeTruthy();
    expect(screen.queryByText("system:in-progress")).toBeNull();
  });

  it("falls back to the system status label when no custom status is persisted", () => {
    render(<OrderStatusBadge status="completed" customStatus={null} />);
    expect(screen.getByText("system:completed")).toBeTruthy();
  });

  it("shows system Cancelled even when a stale custom status is attached", () => {
    render(<OrderStatusBadge status="cancelled" customStatus={{ name: "In Progress", color: "#111" }} />);
    expect(screen.getByText("system:cancelled")).toBeTruthy();
    expect(screen.queryByText("In Progress")).toBeNull();
  });

  it("shows system Closed even when a stale custom status is attached", () => {
    render(<OrderStatusBadge status="closed" customStatus={{ name: "Waiting parts", color: "#0f0" }} />);
    expect(screen.getByText("system:closed")).toBeTruthy();
    expect(screen.queryByText("Waiting parts")).toBeNull();
  });

  it("falls back to system Cancelled when no custom annotation is set", () => {
    render(<OrderStatusBadge status="cancelled" customStatus={null} />);
    expect(screen.getByText("system:cancelled")).toBeTruthy();
  });
});
