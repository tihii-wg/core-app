import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Service } from "../../lib/types";
import ServiceCombobox from "./ServiceCombobox";

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));

const services: Service[] = [
  {
    id: "service-1",
    service_name: "Oil change",
    category: "repair",
    duration: 30,
    service_price: 40,
    description: "",
    status: "active",
  },
  {
    id: "service-2",
    service_name: "Retired wash",
    category: "repair",
    duration: 15,
    service_price: 15,
    description: "",
    status: "inactive",
  },
];

describe("ServiceCombobox", () => {
  it("lists active services with name and catalog price", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ServiceCombobox services={services} onSelect={onSelect} />);

    await user.click(screen.getByPlaceholderText("Service"));

    const option = screen.getByRole("button", { name: /Oil change, MDL 40\.00/i });
    expect(option).toBeInTheDocument();
    expect(screen.getByText("Repair")).toBeInTheDocument();
    expect(screen.queryByText("Retired wash")).not.toBeInTheDocument();

    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(services[0]);
  });

  it("closes the service list when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ServiceCombobox services={services} />
        <button type="button">Outside</button>
      </div>,
    );

    await user.click(screen.getByPlaceholderText("Service"));
    expect(screen.getByRole("button", { name: /Oil change/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("button", { name: /Oil change/i })).not.toBeInTheDocument();
  });

  it("creates a custom service from typed text", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ServiceCombobox services={services} onCreate={onCreate} />);

    await user.type(screen.getByPlaceholderText("Service"), "Wheel alignment");
    await user.type(screen.getByLabelText("Price"), "25");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onCreate).toHaveBeenCalledWith("Wheel alignment", 25);
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ServiceCombobox services={services} allowCreate={false} />);

    await user.type(screen.getByPlaceholderText("Service"), "zzzz");
    expect(screen.getByText("No matching active services.")).toBeInTheDocument();
  });
});
