import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import OrderTotalsSummary from "./OrderTotalsSummary";
import type { OrderMoney } from "./orderTotals";

const money: OrderMoney = {
  subtotal: 1200,
  discountTotal: 0,
  total: 1200,
};

function renderSummary(vatRate: number | null) {
  return render(
    <MemoryRouter initialEntries={["/en/ws1/orders"]}>
      <Routes>
        <Route
          path="/:locale/:workspaceId/*"
          element={<OrderTotalsSummary money={money} formatMoney={(n) => `${n}`} vatRate={vatRate} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OrderTotalsSummary VAT", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the VAT-inclusive breakdown when a rate is set", () => {
    renderSummary(20);
    expect(screen.getByTestId("order-vat-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("order-vat-breakdown-net")).toHaveTextContent("1000");
    expect(screen.getByTestId("order-vat-breakdown-vat")).toHaveTextContent("200");
    expect(screen.getByTestId("order-vat-breakdown-gross")).toHaveTextContent("1200");
  });

  it("hides the VAT block and shows the settings hint when no rate is set", () => {
    renderSummary(null);
    expect(screen.queryByTestId("order-vat-breakdown")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-vat-breakdown-hint")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set vat rate/i })).toHaveAttribute(
      "href",
      "/en/ws1/settings?tab=taxes",
    );
  });
});
