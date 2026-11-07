import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderLinePriceField from "./OrderLinePriceField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { price?: string }) => {
      if (key === "orders.form.catalogPriceHint") return `Catalog: ${opts?.price ?? ""}`;
      if (key === "orders.form.resetToCatalogPrice") return "Reset to catalog price";
      if (key === "orders.form.linePrice") return "Price";
      return key;
    },
  }),
}));

describe("OrderLinePriceField", () => {
  it("shows catalog hint and resets to catalog price when diverged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OrderLinePriceField
        id="price-1"
        value={10000}
        catalogPrice={15000}
        formatMoney={(n) => String(n)}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Catalog: 15000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset to catalog price" }));
    expect(onChange).toHaveBeenCalledWith(15000);
  });

  it("hides catalog hint when price matches catalog", () => {
    render(
      <OrderLinePriceField
        id="price-2"
        value={15000}
        catalogPrice={15000}
        formatMoney={(n) => String(n)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Catalog:/)).not.toBeInTheDocument();
  });
});
