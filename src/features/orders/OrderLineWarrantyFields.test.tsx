import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryWorkflow } from "../industries/industryWorkflow";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";

describe("OrderLineWarrantyFields", () => {
  it("renders km only for auto_repair (mileage warranty industries)", () => {
    const showKm = industryUsesMileageWarranty(industryWorkflow("auto_repair"));
    expect(showKm).toBe(true);

    renderWithQuery(
      <OrderLineWarrantyFields
        idPrefix="test"
        months={12}
        days={null}
        km={10000}
        showWarrantyKm={showKm}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Warranty \(km\)/i)).toBeInTheDocument();
    expect(screen.getByText(/whichever comes first/i)).toBeInTheDocument();
  });

  it("hides km and shows duration-only hint for non-vehicle industries", () => {
    const showKm = industryUsesMileageWarranty(industryWorkflow("furniture_manufacturing"));
    expect(showKm).toBe(false);

    renderWithQuery(
      <OrderLineWarrantyFields
        idPrefix="test-furniture"
        months={12}
        days={null}
        km={10000}
        showWarrantyKm={showKm}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/Warranty \(km\)/i)).toBeNull();
    expect(screen.queryByText(/whichever comes first/i)).toBeNull();
    expect(screen.getByText(/Warranty ends when the time limit is reached/i)).toBeInTheDocument();
  });
});
