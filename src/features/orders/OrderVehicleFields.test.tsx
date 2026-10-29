import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Vehicle } from "../../lib/types";
import { OrderVehicleFields } from "./OrderVehicleFields";
import OrderAssetFields from "./OrderAssetFields";
import { industryOrderCopy, industryWorkflow } from "../industries/industryWorkflow";

const vehiclesState = vi.hoisted(() => ({
  vehicles: [] as Vehicle[],
  createVehicle: vi.fn(),
}));

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({ vehicles: vehiclesState.vehicles, isLoading: false, isError: false }),
  clientVehiclesQueryKey: (workspaceId: string | undefined, clientId: string) => ["vehicles", workspaceId, clientId],
}));

vi.mock("../vehicles/useVehicleMutations", () => ({
  useCreateVehicle: () => ({
    mutateAsync: vehiclesState.createVehicle,
    isPending: false,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => {},
}));

const tVehicleSelect = /^Vehicle$/i;

const sampleVehicle: Vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "client-1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: "1HGBH41JXMN109186",
  licensePlate: "ABC123",
  initialMileage: null,
  currentMileage: null,
  engineDisplacement: null,
  fuelType: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

type FormValues = {
  vehicleId: string;
  device: string;
  carNumber: string;
  vin: string;
};

/** Mirrors Add/Edit order forms: vehicle industries always hide duplicate asset inputs. */
function Harness({ clientId = "client-1", initialVehicleId = "" }: { clientId?: string; initialVehicleId?: string }) {
  const workflow = industryWorkflow("auto_repair");
  const copy = industryOrderCopy(workflow);
  const { control, setValue, register, formState } = useForm<FormValues>({
    defaultValues: { vehicleId: initialVehicleId, device: "", carNumber: "", vin: "" },
  });

  return (
    <div>
      <OrderVehicleFields control={control} setValue={setValue} clientId={clientId} />
      <OrderAssetFields
        register={register}
        errors={formState.errors}
        workflow={workflow}
        copy={copy}
        preserveHiddenValues
        hideVisibleFields
      />
    </div>
  );
}

describe("OrderVehicleFields without duplicate asset fields", () => {
  beforeEach(() => {
    vehiclesState.vehicles = [sampleVehicle];
    vehiclesState.createVehicle.mockReset();
    vehiclesState.createVehicle.mockImplementation(async (input: { make?: string | null; vin?: string | null; licensePlate?: string | null }) => {
      const created: Vehicle = {
        ...sampleVehicle,
        id: "veh-new",
        make: input.make ?? "Honda",
        model: "Civic",
        year: 2020,
        vin: input.vin ?? "2HGES16575H123456",
        licensePlate: input.licensePlate ?? "XYZ999",
      };
      vehiclesState.vehicles = [...vehiclesState.vehicles, created];
      return created;
    });
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("never shows order-level make/plate/VIN fields; selector stays optional", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    expect(screen.getByRole("combobox", { name: tVehicleSelect })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^License plate$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Make and model/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("selected-vehicle-summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));

    expect(screen.getByTestId("selected-vehicle-summary")).toBeInTheDocument();
    expect(within(screen.getByTestId("selected-vehicle-summary")).getByText(/Toyota Corolla 2018/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
  });

  it("keeps asset fields hidden when the vehicle selection is cleared", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness initialVehicleId="veh-1" />);

    expect(screen.getByTestId("selected-vehicle-summary")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /No vehicle/i }));

    expect(screen.queryByTestId("selected-vehicle-summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^License plate$/i)).not.toBeInTheDocument();
  });

  it("clears a vehicle that does not belong to the current client list", () => {
    vehiclesState.vehicles = [];
    renderWithQuery(<Harness initialVehicleId="veh-other" />);

    expect(screen.queryByTestId("selected-vehicle-summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
  });

  it("shows a summary after creating a vehicle from the order form Add vehicle action", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("button", { name: /Add vehicle/i }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText(/^Make$/), "Honda");
    await user.type(within(dialog).getByLabelText(/^VIN$/), "2HGES16575H123456");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await vi.waitFor(() => expect(vehiclesState.createVehicle).toHaveBeenCalled());
    expect(await screen.findByTestId("selected-vehicle-summary")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
  });

  it("shows a summary when editing an order that already has a vehicle_id", () => {
    renderWithQuery(<Harness initialVehicleId="veh-1" />);

    expect(screen.getByTestId("selected-vehicle-summary")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^License plate$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: tVehicleSelect })).toBeInTheDocument();
  });
});
