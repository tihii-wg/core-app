import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Service } from "../../lib/types";
import ServiceCombobox from "./ServiceCombobox";

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
];

describe("ServiceCombobox", () => {
  it("closes the service list when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ServiceCombobox services={services} />
        <button type="button">Outside</button>
      </div>,
    );

    await user.click(screen.getByPlaceholderText("Service"));
    expect(screen.getByRole("button", { name: "Oil change" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("button", { name: "Oil change" })).not.toBeInTheDocument();
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
});
