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
  currentMileage: 45000,
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
  currentMileage: string;
};

/** Mirrors Add/Edit order forms: vehicle industries always hide duplicate asset inputs. */
function Harness({
  clientId = "client-1",
  initialVehicleId = "",
  initialDevice = "",
  initialCarNumber = "",
  initialVin = "",
  initialCurrentMileage = "",
  mileageMode = "empty",
}: {
  clientId?: string;
  initialVehicleId?: string;
  initialDevice?: string;
  initialCarNumber?: string;
  initialVin?: string;
  initialCurrentMileage?: string;
  mileageMode?: "empty" | "vehicle";
}) {
  const workflow = industryWorkflow("auto_repair");
  const copy = industryOrderCopy(workflow);
  const { control, setValue, register, formState, watch, handleSubmit } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: {
      vehicleId: initialVehicleId,
      device: initialDevice,
      carNumber: initialCarNumber,
      vin: initialVin,
      currentMileage: initialCurrentMileage,
    },
  });
  const values = watch();

  return (
    <div>
      <OrderVehicleFields
        control={control}
        setValue={setValue}
        register={register}
        errors={formState.errors}
        clientId={clientId}
        mileageMode={mileageMode}
      />
      <OrderAssetFields
        register={register}
        errors={formState.errors}
        workflow={workflow}
        copy={copy}
        preserveHiddenValues
        hideVisibleFields
      />
      <button type="button" onClick={() => void handleSubmit(() => undefined)()}>
        Save harness
      </button>
      <pre data-testid="asset-snapshot">{JSON.stringify({
        vehicleId: values.vehicleId,
        device: values.device,
        carNumber: values.carNumber,
        vin: values.vin,
        currentMileage: values.currentMileage,
      })}</pre>
    </div>
  );
}

function readSnapshot() {
  return JSON.parse(screen.getByTestId("asset-snapshot").textContent || "{}") as FormValues;
}

describe("OrderVehicleFields without duplicate asset fields", () => {
  beforeEach(() => {
    vehiclesState.vehicles = [sampleVehicle];
    vehiclesState.createVehicle.mockReset();
    vehiclesState.createVehicle.mockImplementation(async (input: { make?: string | null; model?: string | null; vin?: string | null; licensePlate?: string | null }) => {
      const created: Vehicle = {
        ...sampleVehicle,
        id: "veh-new",
        make: input.make?.trim() || "Honda",
        model: input.model?.trim() || "Civic",
        year: 2020,
        vin: input.vin?.trim() || "2HGES16575H123456",
        licensePlate: input.licensePlate?.trim() || "XYZ999",
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
    await vi.waitFor(() => {
      expect(readSnapshot()).toMatchObject({
        vehicleId: "veh-new",
        device: "Honda Civic 2020",
        carNumber: "XYZ999",
        vin: "2HGES16575H123456",
      });
    });
  });

  it("shows a summary when editing an order that already has a vehicle_id", () => {
    renderWithQuery(<Harness initialVehicleId="veh-1" />);

    expect(screen.getByTestId("selected-vehicle-summary")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^License plate$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: tVehicleSelect })).toBeInTheDocument();
  });

  it("snapshots device, plate, and VIN when selecting an existing vehicle", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));

    await vi.waitFor(() => {
      expect(readSnapshot()).toEqual({
        vehicleId: "veh-1",
        device: "Toyota Corolla 2018",
        carNumber: "ABC123",
        vin: "1HGBH41JXMN109186",
        currentMileage: "",
      });
    });
    expect(screen.getByLabelText(/^Current mileage$/i)).toHaveValue("");
  });

  it("keeps current mileage empty on new orders even when the vehicle has stored mileage", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness mileageMode="empty" />);

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));

    await vi.waitFor(() => expect(readSnapshot().currentMileage).toBe(""));
    expect(screen.getByLabelText(/^Current mileage$/i)).toHaveValue("");
  });

  it("prefills current mileage from the vehicle when editing an order", async () => {
    renderWithQuery(<Harness initialVehicleId="veh-1" mileageMode="vehicle" />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/^Current mileage$/i)).toHaveValue("45000");
    });
    expect(readSnapshot().currentMileage).toBe("45000");
  });

  it("rejects negative and decimal mileage values", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness initialVehicleId="veh-1" />);

    const mileage = await screen.findByLabelText(/^Current mileage$/i);
    await user.type(mileage, "-5");
    await user.click(screen.getByRole("button", { name: /Save harness/i }));
    expect(await screen.findByText(/whole number zero or greater|Mileage must be/i)).toBeInTheDocument();

    await user.clear(mileage);
    await user.type(mileage, "12.5");
    await user.click(screen.getByRole("button", { name: /Save harness/i }));
    expect(await screen.findByText(/whole number zero or greater|Mileage must be/i)).toBeInTheDocument();
  });

  it("leaves missing vehicle fields empty in the order snapshot", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      {
        ...sampleVehicle,
        id: "veh-sparse",
        make: null,
        model: null,
        year: null,
        vin: null,
        licensePlate: null,
        currentMileage: null,
      },
    ];
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Untitled/i }));

    await vi.waitFor(() => {
      expect(readSnapshot()).toEqual({
        vehicleId: "veh-sparse",
        device: "",
        carNumber: "",
        vin: "",
        currentMileage: "",
      });
    });
  });

  it("resets new-order mileage when the selected vehicle changes", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      sampleVehicle,
      {
        ...sampleVehicle,
        id: "veh-2",
        make: "Honda",
        model: "Civic",
        year: 2020,
        vin: "2HGES16575H123456",
        licensePlate: "XYZ999",
        currentMileage: 12000,
      },
    ];
    renderWithQuery(<Harness mileageMode="empty" />);

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));
    await vi.waitFor(() => expect(readSnapshot().vehicleId).toBe("veh-1"));

    const mileage = screen.getByLabelText(/^Current mileage$/i);
    await user.type(mileage, "99999");
    expect(mileage).toHaveValue("99999");

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Honda Civic/i }));

    await vi.waitFor(() => {
      expect(readSnapshot()).toEqual({
        vehicleId: "veh-2",
        device: "Honda Civic 2020",
        carNumber: "XYZ999",
        vin: "2HGES16575H123456",
        currentMileage: "",
      });
    });
    expect(screen.getByLabelText(/^Current mileage$/i)).toHaveValue("");
  });

  it("preserves existing order snapshot fields until the vehicle association changes", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      sampleVehicle,
      {
        ...sampleVehicle,
        id: "veh-2",
        make: "Honda",
        model: "Civic",
        year: null,
        vin: null,
        licensePlate: "XYZ999",
        currentMileage: null,
      },
    ];
    renderWithQuery(
      <Harness
        initialVehicleId="veh-1"
        initialDevice="Legacy Device"
        initialCarNumber="OLD1"
        initialVin="1HGBH41JXMN109186"
        mileageMode="vehicle"
      />,
    );

    await vi.waitFor(() => {
      expect(readSnapshot()).toEqual({
        vehicleId: "veh-1",
        device: "Legacy Device",
        carNumber: "OLD1",
        vin: "1HGBH41JXMN109186",
        currentMileage: "45000",
      });
    });

    await user.click(screen.getByRole("combobox", { name: tVehicleSelect }));
    await user.click(await screen.findByRole("option", { name: /Honda Civic/i }));

    await vi.waitFor(() => {
      expect(readSnapshot()).toEqual({
        vehicleId: "veh-2",
        device: "Honda Civic",
        carNumber: "XYZ999",
        vin: "",
        currentMileage: "",
      });
    });
  });
});
