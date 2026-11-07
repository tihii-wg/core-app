import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";

describe("OrderLineWarrantyBadge", () => {
  it("renders nothing when the line has no warranty", () => {
    const { container } = renderWithQuery(
      <OrderLineWarrantyBadge limits={{ durationMonths: null, mileageLimit: null }} />,
    );
    expect(container.querySelector("[data-warranty-line]")).toBeNull();
  });

  it("shows months, days, and combined coverage labels", () => {
    const { rerender } = renderWithQuery(
      <OrderLineWarrantyBadge limits={{ durationMonths: 3, mileageLimit: null }} />,
    );
    expect(screen.getByText("Warranty: 3 months")).toBeInTheDocument();

    rerender(<OrderLineWarrantyBadge limits={{ durationMonths: null, durationDays: 15, mileageLimit: null }} />);
    expect(screen.getByText("Warranty: 15 days")).toBeInTheDocument();

    rerender(<OrderLineWarrantyBadge limits={{ durationMonths: 3, mileageLimit: 10000 }} />);
    expect(screen.getByText(/Warranty: 3 months \/ 10,000 km/)).toBeInTheDocument();

    rerender(<OrderLineWarrantyBadge limits={{ durationMonths: null, mileageLimit: 31069 }} mileageUnit="mi" />);
    expect(screen.getByText(/Warranty: 31,069 mi/)).toBeInTheDocument();
  });
});
