import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClientSettlementRow } from "./clientSettlement";
import { SettlementOrderCard } from "./SettlementOrderCard";

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

const longRow: ClientSettlementRow = {
  id: "order-b",
  orderNumber: "ORD-2026-000123",
  date: "2026-10-22",
  total: 1250,
  paid: 0,
  remaining: 1250,
  isPaid: false,
  status: "completed",
  device: "Mercedes-Benz Sprinter 316 CDI Extra Long",
  carNumber: "B123XYZ",
  service: "Oil change and filter replacement with extra notes",
};

function renderCard(overrides: Partial<ClientSettlementRow> = {}, onOpen = vi.fn()) {
  const utils = render(
    <div style={{ width: 320 }}>
      <SettlementOrderCard
        row={{ ...longRow, ...overrides }}
        formatMoney={(value) => `MDL ${value.toFixed(2)}`}
        onOpen={onOpen}
      />
    </div>,
  );
  return { onOpen, ...utils };
}

describe("SettlementOrderCard", () => {
  it("shows order number, vehicle, remaining amount, date, and badges with truncation-friendly classes", () => {
    const { container } = renderCard();

    expect(screen.getByRole("button", { name: "ORD-2026-000123" })).toBeInTheDocument();
    expect(screen.getByText("Mercedes-Benz Sprinter 316 CDI Extra Long")).toBeInTheDocument();
    expect(screen.getByText("B123XYZ")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    expect(screen.getByText("MDL 1250.00")).toBeInTheDocument();
    expect(screen.getByText("2026-10-22")).toBeInTheDocument();
    expect(container.querySelector(".truncate")).not.toBeNull();
    expect(container.querySelector(".break-all")).not.toBeNull();
    // Card surface itself must not force a wide horizontal scroll.
    expect(container.firstElementChild?.scrollWidth ?? 0).toBeLessThanOrEqual((container.firstElementChild?.clientWidth ?? 0) + 1);
  });

  it("falls back to the service line when no vehicle is set", () => {
    renderCard({ device: "", carNumber: "" });
    expect(screen.getByText("Oil change and filter replacement with extra notes")).toBeInTheDocument();
  });

  it("opens the order from the card surface and from the order number", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderCard();

    await user.click(screen.getByText("Mercedes-Benz Sprinter 316 CDI Extra Long"));
    expect(onOpen).toHaveBeenCalledWith("order-b");

    onOpen.mockClear();
    await user.click(screen.getByRole("button", { name: "ORD-2026-000123" }));
    expect(onOpen).toHaveBeenCalledWith("order-b");
  });
});
