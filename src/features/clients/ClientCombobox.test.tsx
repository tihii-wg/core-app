import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Client } from "../../lib/types";
import type { VehicleRegistrationSearchHit } from "../../services/apiVehicles";
import ClientCombobox from "./ClientCombobox";

const pavelA: Client = {
  id: "client-a",
  name: "Pavel",
  email: "",
  phone: "+37369111111",
  address: "",
  balance: 0,
  created_at: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const pavelB: Client = {
  ...pavelA,
  id: "client-b",
  phone: "+37368222222",
};

describe("ClientCombobox duplicate names", () => {
  it("keeps the list closed until focus and lists every matching client by id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreateRequest = vi.fn();
    const onChange = vi.fn();

    const { rerender } = renderWithQuery(
      <ClientCombobox
        clients={[pavelA, pavelB]}
        value="Pav"
        onChange={onChange}
        onSelect={onSelect}
        onCreateRequest={onCreateRequest}
      />,
    );

    expect(screen.queryByText("+37369111111")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /^Client$/i }));

    expect(screen.getByText("+37369111111")).toBeInTheDocument();
    expect(screen.getByText("+37368222222")).toBeInTheDocument();
    expect(screen.getAllByText("Pavel")).toHaveLength(2);

    await user.click(screen.getByText("+37368222222"));
    expect(onSelect).toHaveBeenCalledWith(pavelB);
    expect(screen.queryByText("+37369111111")).not.toBeInTheDocument();

    onCreateRequest.mockClear();
    rerender(
      <ClientCombobox
        clients={[pavelA, pavelB]}
        value="Pavel"
        onChange={onChange}
        onSelect={onSelect}
        onCreateRequest={onCreateRequest}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /^Client$/i }));
    await user.click(screen.getByRole("button", { name: /Create new client/i }));
    expect(onCreateRequest).toHaveBeenCalledWith("Pavel");
  });
});

describe("ClientCombobox vehicle registration hits", () => {
  const hitA: VehicleRegistrationSearchHit = {
    vehicleId: "veh-a",
    licensePlate: "B123ABC",
    make: "Toyota",
    model: "Corolla",
    year: 2018,
    client: pavelA,
  };
  const hitB: VehicleRegistrationSearchHit = {
    vehicleId: "veh-b",
    licensePlate: "B123XYZ",
    make: "VW",
    model: "Golf",
    year: 2020,
    client: pavelB,
  };

  it("lists each matching vehicle separately and selects client + vehicle together", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSelectVehicle = vi.fn();

    renderWithQuery(
      <ClientCombobox
        clients={[pavelA]}
        value="B123"
        onChange={vi.fn()}
        onSelect={onSelect}
        onSelectVehicle={onSelectVehicle}
        vehicleHits={[hitA, hitB]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByTestId("client-combobox-vehicle-hits")).toBeInTheDocument();
    expect(screen.getByText("Toyota Corolla 2018 · B123ABC")).toBeInTheDocument();
    expect(screen.getByText("VW Golf 2020 · B123XYZ")).toBeInTheDocument();

    await user.click(screen.getByTestId("client-combobox-vehicle-veh-b"));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(hitB);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps client name matches available alongside vehicle hits", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    renderWithQuery(
      <ClientCombobox
        clients={[pavelA]}
        value="Pav"
        onChange={vi.fn()}
        onSelect={onSelect}
        onSelectVehicle={vi.fn()}
        vehicleHits={[hitA]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Vehicles")).toBeInTheDocument();
    expect(screen.getByText("Clients")).toBeInTheDocument();
    await user.click(screen.getByText("+37369111111"));
    expect(onSelect).toHaveBeenCalledWith(pavelA);
  });

  it("keeps phone-matched clients visible despite formatting differences", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSelectVehicle = vi.fn();

    renderWithQuery(
      <ClientCombobox
        clients={[pavelA]}
        value="069111111"
        onChange={vi.fn()}
        onSelect={onSelect}
        onSelectVehicle={onSelectVehicle}
        vehicleHits={[]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Pavel")).toBeInTheDocument();
    expect(screen.getByText("+37369111111")).toBeInTheDocument();
    await user.click(screen.getByText("+37369111111"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(pavelA);
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it("lists make/model vehicle hits without requiring a plate", async () => {
    const user = userEvent.setup();
    const onSelectVehicle = vi.fn();
    const makeHit: VehicleRegistrationSearchHit = {
      vehicleId: "veh-camry",
      licensePlate: "",
      make: "Toyota",
      model: "Camry",
      year: 2019,
      client: pavelA,
    };

    renderWithQuery(
      <ClientCombobox
        clients={[]}
        value="Camry"
        onChange={vi.fn()}
        onSelect={vi.fn()}
        onSelectVehicle={onSelectVehicle}
        vehicleHits={[makeHit]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Toyota Camry 2019")).toBeInTheDocument();
    await user.click(screen.getByTestId("client-combobox-vehicle-veh-camry"));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(makeHit);
  });
});
