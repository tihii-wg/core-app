import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { VehicleFields } from "./VehicleFields";
import { emptyVehicleFormValues, vehicleToFormValues, type VehicleFormValues } from "./vehicleForm";
import type { Vehicle } from "../../lib/types";

const sampleVehicle: Vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "client-1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: null,
  licensePlate: "ABC123",
  initialMileage: 10000,
  currentMileage: 45200,
  mileageUnit: null,
  engineDisplacement: null,
  fuelType: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

function Harness({ initial, mode }: { initial?: Vehicle | null; mode?: "create" | "edit" }) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    defaultValues: initial ? vehicleToFormValues(initial) : emptyVehicleFormValues(),
  });
  const mileageUnit = watch("mileageUnit");
  const fieldsMode = mode ?? (initial ? "edit" : "create");

  return (
    <div>
      <VehicleFields
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
        mode={fieldsMode}
      />
      <pre data-testid="mileage-unit-value">{mileageUnit || ""}</pre>
      <pre data-testid="initial-mileage-value">{watch("initialMileage")}</pre>
      <pre data-testid="current-mileage-value">{watch("currentMileage")}</pre>
    </div>
  );
}

describe("VehicleFields mileage unit selector", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("shows an enabled Select unit control with km and mi only", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    const trigger = screen.getByRole("combobox", { name: /Mileage unit/i });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveTextContent(/Select unit/i);
    expect(screen.queryByText(/ед\.?/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mileage-unit-unavailable")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(await screen.findByRole("option", { name: /Kilometers \(km\)/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Miles \(mi\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Not set/i })).not.toBeInTheDocument();
  });

  it("lets the user select a unit independently of odometer values", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("combobox", { name: /Mileage unit/i }));
    await user.click(await screen.findByRole("option", { name: /Miles \(mi\)/i }));

    expect(screen.getByTestId("mileage-unit-value")).toHaveTextContent("mi");
    expect(screen.getByRole("combobox", { name: /Mileage unit/i })).toHaveTextContent(/Miles \(mi\)/i);
  });

  it("loads a saved unit when editing and allows changing it", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness initial={{ ...sampleVehicle, mileageUnit: "km" }} />);

    expect(screen.getByTestId("mileage-unit-value")).toHaveTextContent("km");
    expect(screen.getByRole("combobox", { name: /Mileage unit/i })).toHaveTextContent(/Kilometers \(km\)/i);

    await user.click(screen.getByRole("combobox", { name: /Mileage unit/i }));
    await user.click(await screen.findByRole("option", { name: /Miles \(mi\)/i }));

    expect(screen.getByTestId("mileage-unit-value")).toHaveTextContent("mi");
  });

  it("keeps null-unit vehicles on the Select unit placeholder", () => {
    renderWithQuery(<Harness initial={{ ...sampleVehicle, mileageUnit: null }} />);

    expect(screen.getByTestId("mileage-unit-value")).toHaveTextContent("");
    expect(screen.getByRole("combobox", { name: /Mileage unit/i })).toHaveTextContent(/Select unit/i);
    expect(screen.queryByText(/unit\?/i)).not.toBeInTheDocument();
  });

  it("create mode shows one mileage field that mirrors into current", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness mode="create" />);

    expect(screen.getByTestId("vehicle-create-mileage")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Initial mileage/i)).not.toBeInTheDocument();
    await user.type(screen.getByTestId("vehicle-create-mileage"), "46010");
    expect(screen.getByTestId("initial-mileage-value")).toHaveTextContent("46010");
    expect(screen.getByTestId("current-mileage-value")).toHaveTextContent("46010");
  });

  it("edit mode keeps both mileage fields with hints", () => {
    renderWithQuery(<Harness initial={sampleVehicle} mode="edit" />);
    expect(screen.getByLabelText(/Initial mileage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Current odometer reading/i)).toBeInTheDocument();
    expect(screen.getByText(/Initial — at first visit|Начальный — при первом визите/i)).toBeInTheDocument();
    expect(screen.getByText(/Current — last known|Текущий — последний известный/i)).toBeInTheDocument();
  });
});
