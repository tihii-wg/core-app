import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { OrderWarrantyPauseNotice } from "./OrderWarrantyPauseNotice";

describe("OrderWarrantyPauseNotice", () => {
  it("shows only for cancelled/reopened orders that have warranty records", () => {
    const { rerender } = renderWithQuery(
      <OrderWarrantyPauseNotice
        order={{ status: "cancelled", closedAt: "2026-05-01T00:00:00.000Z" }}
        records={[{ startsAt: "2026-05-01T12:00:00.000Z" }]}
      />,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-warranty-pause-notice");
    expect(screen.getByRole("status").textContent).toMatch(/paused until it is closed again/i);
    expect(screen.getByRole("status").textContent).toMatch(/01\.05\.2026/);

    rerender(
      <OrderWarrantyPauseNotice
        order={{ status: "closed", closedAt: "2026-05-01T00:00:00.000Z" }}
        records={[{ startsAt: "2026-05-01T12:00:00.000Z" }]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <OrderWarrantyPauseNotice
        order={{ status: "cancelled", closedAt: "2026-05-01T00:00:00.000Z" }}
        records={[]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <OrderWarrantyPauseNotice
        order={{ status: "in-progress", closedAt: null }}
        records={[{ startsAt: "2026-05-01T12:00:00.000Z" }]}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
