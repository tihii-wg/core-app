import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "../../lib/types";
import AddNewOrderForm from "./AddNewOrderForm";

const createOrderMock = vi.hoisted(() => vi.fn());
const persistMileageMock = vi.hoisted(() => vi.fn());

const employeesState = vi.hoisted(() => ({
  employees: [] as { id: string; name: string; status: string; role: string; profile_id: string | null }[],
  role: "owner" as string | null,
  industrySlug: "auto_repair" as string | null,
  services: [] as Service[],
}));

const vehiclesState = vi.hoisted(() => ({
  vehicles: [] as {
    id: string;
    workspaceId: string;
    clientId: string;
    make: string;
    model: string;
    year: number | null;
    vin: string | null;
    licensePlate: string | null;
    initialMileage: number | null;
    currentMileage: number | null;
    engineDisplacement: null;
    fuelType: null;
    createdAt: string;
    updatedAt: string;
    deletedAt: null;
  }[],
}));

vi.mock("./useCreateOrder", () => ({
  useCreateOrder: () => ({
    mutateAsync: createOrderMock,
  }),
}));

vi.mock("../clients/useGetClients", () => ({
  useGetClients: () => ({ clients: [] }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: employeesState.services }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: employeesState.employees, error: null, isLoading: false }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useGetProfile: () => ({ data: undefined }),
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => employeesState.role,
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(employeesState.industrySlug);
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: employeesState.industrySlug, industryId: null, isLoading: false, error: null };
    },
  };
});

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({ vehicles: vehiclesState.vehicles, isLoading: false, isError: false }),
  clientVehiclesQueryKey: (workspaceId: string | undefined, clientId: string) => ["vehicles", workspaceId, clientId],
}));

const createVehicleMock = vi.hoisted(() => vi.fn());

vi.mock("../vehicles/useVehicleMutations", () => ({
  useCreateVehicle: () => ({
    mutateAsync: createVehicleMock,
    isPending: false,
  }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => {},
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("./orderVehicleMileage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orderVehicleMileage")>();
  return {
    ...actual,
    persistOrderVehicleMileage: (...args: unknown[]) => persistMileageMock(...args),
  };
});

async function addCustomService(user: ReturnType<typeof userEvent.setup>, name: string, price: string) {
  await user.type(screen.getByLabelText(/^Service$/), name);
  await user.type(screen.getByLabelText("Price"), price);
  await user.click(screen.getByRole("button", { name: "Add" }));
}

const saveDraftButton = () => screen.getByRole("button", { name: "Save draft order" });

describe("AddNewOrderForm client validation", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    createOrderMock.mockResolvedValue({ id: "order-1" });
    persistMileageMock.mockReset();
    persistMileageMock.mockResolvedValue(null);
    createVehicleMock.mockReset();
    createVehicleMock.mockImplementation(async (input: { make?: string | null; model?: string | null; vin?: string | null; licensePlate?: string | null }) => {
      const created = {
        id: "veh-new",
        workspaceId: "ws-1",
        clientId: "client-1",
        make: input.make?.trim() || "Honda",
        model: input.model?.trim() || "Civic",
        year: 2020,
        vin: input.vin?.trim() || "2HGES16575H123456",
        licensePlate: input.licensePlate?.trim() || "XYZ999",
        initialMileage: null,
        currentMileage: null,
        engineDisplacement: null,
        fuelType: null,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      };
      vehiclesState.vehicles = [...vehiclesState.vehicles, created];
      return created;
    });
    employeesState.employees = [];
    employeesState.role = "owner";
    employeesState.industrySlug = "auto_repair";
    employeesState.services = [];
    vehiclesState.vehicles = [];
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("saves an empty draft without requiring client, vehicle, or services", async () => {
    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery="" />);

    const draft = saveDraftButton();
    await user.click(draft);
    await new Promise((r) => setTimeout(r, 200));
    if (createOrderMock.mock.calls.length === 0) {
      throw new Error(
        "no createOrder: " +
          JSON.stringify({
            disabled: (draft as HTMLButtonElement).disabled,
            vehicles: vehiclesState.vehicles.map((v) => v.id),
            summary: !!screen.queryByTestId("selected-vehicle-summary"),
            body: document.body.innerText.slice(0, 1500),
          }),
      );
    }
    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: undefined,
        clientName: "",
        vehicleId: null,
        services: [],
      }),
    );
    expect(setCreateModalOpen).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Client is required")).not.toBeInTheDocument();
    expect(screen.queryByText("Vehicle is required")).not.toBeInTheDocument();
  });

  it("hides automotive fields for home_services and does not require them", async () => {
    employeesState.industrySlug = "home_services";
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    expect(screen.queryByLabelText(/License plate/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Job \/ location/i)).toBeInTheDocument();

    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Job or location is required")).not.toBeInTheDocument();
    expect(screen.queryByText("License plate is required")).not.toBeInTheDocument();
    expect(screen.queryByText("VIN is required")).not.toBeInTheDocument();
  });

  it("does not show order-level plate/VIN/make on auto_repair (vehicles use client vehicle workflow)", () => {
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/License plate/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Make and model/i)).not.toBeInTheDocument();
  });

  it("shows the client vehicle selector (optional) and can select an existing vehicle", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      {
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
      },
    ];
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    expect(screen.getByRole("combobox", { name: /^Vehicle$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^VIN$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /^Vehicle$/i }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalled());
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: "veh-1",
        device: "Toyota Corolla 2018",
        vin: "1HGBH41JXMN109186",
        carNumber: "ABC123",
      }),
    );
    expect(persistMileageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        formMileage: "",
        vehicle: expect.objectContaining({ id: "veh-1" }),
      }),
    );
  });

  it("leaves current mileage empty on vehicle select and only persists an explicit entry", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      {
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
      },
    ];
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={vi.fn()} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    await user.click(screen.getByRole("combobox", { name: /^Vehicle$/i }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));

    const mileage = await screen.findByLabelText(/^Current mileage$/i);
    expect(mileage).toHaveValue("");
    await user.type(mileage, "46010");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalled());
    expect(persistMileageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        formMileage: "46010",
        vehicle: expect.objectContaining({ id: "veh-1", currentMileage: 45000 }),
      }),
    );
    expect(persistMileageMock.mock.invocationCallOrder[0]).toBeLessThan(createOrderMock.mock.invocationCallOrder[0]);
  });

  it("does not persist stored mileage when the new-order field is left empty", async () => {
    const user = userEvent.setup();
    vehiclesState.vehicles = [
      {
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
      },
    ];
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={vi.fn()} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    await user.click(screen.getByRole("combobox", { name: /^Vehicle$/i }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));
    expect(await screen.findByLabelText(/^Current mileage$/i)).toHaveValue("");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalled());
    expect(persistMileageMock).toHaveBeenCalledWith(expect.objectContaining({ formMileage: "" }));
  });

  it("does not create the order when mileage persistence fails", async () => {
    const user = userEvent.setup();
    persistMileageMock.mockRejectedValue(new Error("mileage write failed"));
    vehiclesState.vehicles = [
      {
        id: "veh-1",
        workspaceId: "ws-1",
        clientId: "client-1",
        make: "Toyota",
        model: "Corolla",
        year: 2018,
        vin: null,
        licensePlate: "ABC123",
        initialMileage: null,
        currentMileage: null,
        engineDisplacement: null,
        fuelType: null,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      },
    ];
    const setCreateModalOpen = vi.fn();
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    await user.click(screen.getByRole("combobox", { name: /^Vehicle$/i }));
    await user.click(await screen.findByRole("option", { name: /Toyota Corolla/i }));
    await user.type(screen.getByLabelText(/^Current mileage$/i), "100");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(persistMileageMock).toHaveBeenCalled());
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(setCreateModalOpen).not.toHaveBeenCalledWith(false);
  });

  it("asks for the phone and email of a new client with the client form's validation", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    expect(screen.queryByLabelText("Phone *")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Client type *" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Client$/), "Nina New");
    expect(screen.getByRole("combobox", { name: "Client type *" })).toHaveTextContent("Individual");
    await user.type(screen.getByLabelText("Phone *"), "069123456");
    await user.click(saveDraftButton());

    expect(await screen.findByText("Phone must be in format +37300000000")).toBeInTheDocument();
    expect(screen.getByText("Email is required")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Client$/));
    expect(screen.queryByLabelText("Phone *")).not.toBeInTheDocument();
    expect(screen.queryByText("Email is required")).not.toBeInTheDocument();
  });

  it("shows the organization name, IDNO and contact name fields only for a new organization", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.type(screen.getByLabelText(/^Client$/), "Fleet SRL");
    expect(screen.queryByLabelText("IDNO")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Client type *" }));
    await user.click(await screen.findByRole("option", { name: "Organization" }));

    expect(screen.getByLabelText(/^Organization name$/)).toHaveValue("Fleet SRL");
    expect(screen.getByLabelText("IDNO")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact name")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Client type *" }));
    await user.click(await screen.findByRole("option", { name: "Individual" }));

    expect(screen.getByLabelText(/^Client$/)).toHaveValue("Fleet SRL");
    expect(screen.queryByLabelText("IDNO")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contact name")).not.toBeInTheDocument();
  });

  it("adds a custom service to the order", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await addCustomService(user, "Wheel alignment", "45");

    expect(screen.getByText("Wheel alignment")).toBeInTheDocument();
    expect(screen.getAllByText("MDL 45.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Total Price").closest("div")).toHaveTextContent("MDL 45.00");
  });

  it("keeps service quantity fixed at one without quantity controls", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await addCustomService(user, "Oil change", "40");

    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Increase quantity for Oil change" })).not.toBeInTheDocument();
    expect(screen.getByText("Total Price").closest("div")).toHaveTextContent("MDL 40.00");
  });

  it("removes only the targeted service line", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await addCustomService(user, "Oil change", "40");
    await addCustomService(user, "Brake check", "25");

    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("Brake check")).toBeInTheDocument();
    expect(screen.getByText("Total Price").closest("div")).toHaveTextContent("MDL 65.00");

    await user.click(screen.getByRole("button", { name: "Remove Oil change" }));

    expect(screen.queryByText("Oil change")).not.toBeInTheDocument();
    expect(screen.getByText("Brake check")).toBeInTheDocument();
    expect(screen.getByText("Total Price").closest("div")).toHaveTextContent("MDL 25.00");
  });

  it("snapshots the catalog price when a service is selected", async () => {
    employeesState.services = [
      {
        id: "svc-oil",
        service_name: "Oil change",
        category: "repair",
        duration: 30,
        service_price: 40,
        description: "",
        status: "active",
      },
    ];
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByLabelText(/^Service$/));
    await user.click(await screen.findByRole("button", { name: /Oil change/i }));

    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getAllByText("MDL 40.00").length).toBeGreaterThanOrEqual(1);
  });

  it("prefills the client when opened from client details", () => {
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="Ada Alpha" initialClientId="client-1" initialClientName="Ada Alpha" />,
    );

    expect(screen.getByLabelText(/^Client$/)).toHaveValue("Ada Alpha");
  });

  it("prevents duplicate submissions while create is in flight", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    createOrderMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    employeesState.employees = [{ id: "emp-1", name: "Ada", status: "active", role: "technician", profile_id: "user-1" }];
    employeesState.industrySlug = "home_services";

    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery="" />);

    await user.type(screen.getByLabelText(/Client|Customer/i), "Ada");
    await user.type(screen.getByLabelText("Phone *"), "+37369123456");
    await user.type(screen.getByLabelText("Email *"), "ada@example.com");
    await user.type(screen.getByLabelText(/Job \/ location/i), "Kitchen");
    await addCustomService(user, "Install sink", "100");
    const assignee = screen.getByRole("combobox", { name: /Assigned technician/i });
    await user.click(assignee);
    await user.click(await screen.findByRole("option", { name: "Ada" }));

    const submit = saveDraftButton();
    await user.click(submit);
    await user.click(submit);

    expect(createOrderMock).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();

    resolveCreate({ id: "order-1" });
    await vi.waitFor(() => expect(setCreateModalOpen).toHaveBeenCalledWith(false));
  });

  it("does not offer to create a catalogue service for view-only roles", async () => {
    employeesState.role = "member";
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.type(screen.getByLabelText(/^Service$/), "Wheel alignment");

    expect(screen.queryByText(/Create:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("keeps the assigned employee select controlled after a choice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    employeesState.employees = [{ id: "emp-1", name: "Ada", status: "active", role: "technician", profile_id: "user-1" }];
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    const assignee = screen.getByRole("combobox", { name: /Assigned technician/i });
    await user.click(assignee);
    await user.click(await screen.findByRole("option", { name: "Ada" }));

    expect(assignee).toHaveTextContent("Ada");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("uncontrolled");
    consoleError.mockRestore();
  });

  it("shows Alexander in the assignee list without a workspace membership or login link", async () => {
    employeesState.employees = [
      { id: "emp-alexander", name: "Alexander", status: "active", role: "technician", profile_id: null },
      { id: "emp-owner", name: "Owner Name", status: "active", role: "admin", profile_id: "owner-1" },
    ];
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("combobox", { name: /Assigned technician/i }));

    expect(await screen.findByRole("option", { name: "Alexander" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Owner Name" })).not.toBeInTheDocument();
  });

  it("creates an inline vehicle without submitting the order, then creates the order only on explicit save", async () => {
    employeesState.employees = [{ id: "emp-1", name: "Ada", status: "active", role: "technician", profile_id: "user-1" }];
    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    await addCustomService(user, "Oil change", "80");
    await user.type(screen.getByLabelText(/^Description$/i), "Needs oil and filter");
    const assignee = screen.getByRole("combobox", { name: /Assigned technician/i });
    await user.click(assignee);
    await user.click(await screen.findByRole("option", { name: "Ada" }));

    await user.click(screen.getByRole("button", { name: /Add vehicle/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Make$/), "Honda");
    await user.type(within(dialog).getByLabelText(/^Model$/), "Civic");
    await user.type(within(dialog).getByLabelText(/^VIN$/), "2HGES16575H123456");
    await user.type(within(dialog).getByLabelText(/License plate/i), "XYZ999");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await vi.waitFor(() => expect(createVehicleMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(setCreateModalOpen).not.toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByTestId("selected-vehicle-summary")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Needs oil and filter")).toBeInTheDocument();
    expect(screen.getByText(/Oil change/i)).toBeInTheDocument();
    expect(assignee).toHaveTextContent("Ada");

    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: "veh-new",
        device: "Honda Civic 2020",
        carNumber: "XYZ999",
        vin: "2HGES16575H123456",
        clientId: "client-1",
        services: [expect.objectContaining({ serviceName: "Oil change", price: 80 })],
      }),
    );
    expect(setCreateModalOpen).toHaveBeenCalledWith(false);
  });

  it("keeps the order form open with entered values when inline vehicle creation fails", async () => {
    createVehicleMock.mockRejectedValueOnce(new Error("vehicle create failed"));
    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(
      <AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery="" initialClientId="client-1" initialClientName="Ada" />,
    );

    await addCustomService(user, "Brake check", "50");
    await user.type(screen.getByLabelText(/^Description$/i), "Squeaky brakes");

    await user.click(screen.getByRole("button", { name: /Add vehicle/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Make$/), "Honda");
    await user.type(within(dialog).getByLabelText(/^VIN$/), "2HGES16575H123456");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await vi.waitFor(() => expect(createVehicleMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(setCreateModalOpen).not.toHaveBeenCalledWith(false);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Squeaky brakes")).toBeInTheDocument();
    expect(screen.getByText(/Brake check/i)).toBeInTheDocument();
  });
});
