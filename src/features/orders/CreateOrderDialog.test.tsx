import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { CreateOrderDialog } from "./CreateOrderDialog";

vi.mock("./AddNewOrderForm", () => ({
  default: ({
    initialClientId,
    initialClientName,
    initialVehicleId,
  }: {
    initialClientId?: string;
    initialClientName?: string;
    initialVehicleId?: string;
  }) => (
    <div
      data-testid="add-new-order-form"
      data-client-id={initialClientId ?? ""}
      data-client-name={initialClientName ?? ""}
      data-vehicle-id={initialVehicleId ?? ""}
    />
  ),
}));

describe("CreateOrderDialog", () => {
  it("passes initial client and vehicle ids into AddNewOrderForm", () => {
    const { rerender } = renderWithQuery(
      <CreateOrderDialog
        open
        onOpenChange={vi.fn()}
        initialClient={{ id: "client-1", name: "Ada" }}
        initialVehicleId="veh-a"
      />,
    );

    const form = screen.getByTestId("add-new-order-form");
    expect(form).toHaveAttribute("data-client-id", "client-1");
    expect(form).toHaveAttribute("data-client-name", "Ada");
    expect(form).toHaveAttribute("data-vehicle-id", "veh-a");

    rerender(
      <CreateOrderDialog
        open
        onOpenChange={vi.fn()}
        initialClient={{ id: "client-1", name: "Ada" }}
        initialVehicleId="veh-b"
      />,
    );

    expect(screen.getByTestId("add-new-order-form")).toHaveAttribute("data-vehicle-id", "veh-b");
  });

  it("does not retain a vehicle when opening for a different client without one", () => {
    const { rerender } = renderWithQuery(
      <CreateOrderDialog
        open
        onOpenChange={vi.fn()}
        initialClient={{ id: "client-1", name: "Ada" }}
        initialVehicleId="veh-a"
      />,
    );
    expect(screen.getByTestId("add-new-order-form")).toHaveAttribute("data-vehicle-id", "veh-a");

    rerender(
      <CreateOrderDialog
        open
        onOpenChange={vi.fn()}
        initialClient={{ id: "client-2", name: "Grace" }}
        initialVehicleId={null}
      />,
    );

    const form = screen.getByTestId("add-new-order-form");
    expect(form).toHaveAttribute("data-client-id", "client-2");
    expect(form).toHaveAttribute("data-vehicle-id", "");
  });
});
