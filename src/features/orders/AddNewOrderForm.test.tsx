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
    mileageUnit: 'km' | 'mi' | null;
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

const clientsState = vi.hoisted(() => ({
  clients: [] as {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    balance: number;
    created_at: string;
    client_type: "individual" | "organization" | null;
    tax_id: string | null;
    contact_person: string | null;
  }[],
}));

vi.mock("../clients/useGetClients", () => ({
  useGetClients: () => ({ clients: clientsState.clients }),
}));

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("../clients/useCreateNewClient", () => ({
  useCreateNewClient: () => ({
    mutateAsync: createClientMock,
  }),
}));

vi.mock("../../services/apiVehicles", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiVehicles")>("../../services/apiVehicles");
  return {
    ...actual,
    createVehicle: (...args: unknown[]) => createVehicleMock(...args),
  };
});

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: {
      defaultPhoneConsent: false,
      defaultEmailConsent: false,
      showClientMiddleName: false,
      warrantyServiceMonths: null,
      warrantyServiceKm: null,
      warrantyPartsMonths: null,
      warrantyPartsKm: null,
    },
  }),
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
  const addButton = await screen.findByRole("button", { name: "Add" });
  // Scope to the combobox create row so per-line OrderLinePriceField inputs are ignored.
  const createRow = addButton.closest("div");
  const priceInput = createRow
    ? within(createRow as HTMLElement).getByLabelText(/^Price$/)
    : screen.getAllByLabelText(/^Price$/).at(-1)!;
  await user.clear(priceInput);
  await user.type(priceInput, price);
  await user.click(addButton);
}

const saveDraftButton = () => screen.getByRole("button", { name: "Save draft order" });

describe("AddNewOrderForm client validation", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    createOrderMock.mockResolvedValue({ id: "order-1" });
    persistMileageMock.mockReset();
    persistMileageMock.mockResolvedValue(null);
    createClientMock.mockReset();
    createClientMock.mockImplementation(async (input: { clientName?: string; phone?: string }) => [
      {
        id: "client-new",
        name: input.clientName?.trim() || "Nina New",
        email: "",
        phone: input.phone?.trim() || "+37369123456",
        address: "",
        balance: 0,
        created_at: "",
        client_type: "individual" as const,
        tax_id: null,
        contact_person: null,
      },
    ]);
    createVehicleMock.mockReset();
    createVehicleMock.mockImplementation(async (...args: unknown[]) => {
      // useCreateVehicle passes (input); apiVehicles.createVehicle passes (workspaceId, clientId, input).
      const input = (
        args.length >= 3 ? args[2] : args[0]
      ) as { make?: string | null; model?: string | null; vin?: string | null; licensePlate?: string | null };
      const clientId = typeof args[1] === "string" ? args[1] : "client-new";
      const created = {
        id: "veh-new",
        workspaceId: "ws-1",
        clientId,
        make: input?.make?.trim() || "Honda",
        model: input?.model?.trim() || "Civic",
        year: 2020,
        vin: input?.vin?.trim() || "2HGES16575H123456",
        licensePlate: input?.licensePlate?.trim() || "XYZ999",
        initialMileage: null,
        currentMileage: null,
        mileageUnit: null,
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
    clientsState.clients = [];
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
        mileageUnit: null,
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
        mileageUnit: "mi",
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

    const mileage = await screen.findByLabelText(/Current odometer reading/i);
    expect(mileage).toHaveValue("");
    await user.type(mileage, "46010");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalled());
    expect(persistMileageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        formMileage: expect.stringMatching(/46[\s,]?010/),
        vehicle: expect.objectContaining({ id: "veh-1", currentMileage: 45000 }),
      }),
    );
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleMileageSnapshot: 46010,
        vehicleMileageUnitSnapshot: "mi",
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
        mileageUnit: null,
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
    expect(await screen.findByLabelText(/Current odometer reading/i)).toHaveValue("");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalled());
    expect(persistMileageMock).toHaveBeenCalledWith(expect.objectContaining({ formMileage: "" }));
    expect(createOrderMock.mock.calls[0]?.[0]).not.toHaveProperty("vehicleMileageSnapshot");
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
        mileageUnit: null,
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
    await user.type(screen.getByLabelText(/Current odometer reading/i), "100");
    await user.click(saveDraftButton());

    await vi.waitFor(() => expect(persistMileageMock).toHaveBeenCalled());
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(setCreateModalOpen).not.toHaveBeenCalledWith(false);
  });

  async function openCreateClientDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
    const clientInput = screen.getByLabelText(/^(Client|Customer|Organization name)$/);
    await user.clear(clientInput);
    await user.type(clientInput, name);
    await user.click(await screen.findByRole("button", { name: /Create new client/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  }

  it("opens the full client dialog with the typed name prefilled", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await openCreateClientDialog(user, "Nina New");
    expect(screen.getByLabelText(/^Full name/i)).toHaveValue("Nina New");
    expect(screen.getByRole("button", { name: /Add Client/i })).toBeInTheDocument();
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("does not submit the order when the nested client dialog is saved", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await openCreateClientDialog(user, "Nina New");
    await user.type(screen.getByLabelText(/^Phone \*$/), "+37369123456");
    await user.click(screen.getByRole("button", { name: /Add Client/i }));

    await vi.waitFor(() => expect(createClientMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Client$/)).toHaveValue("Nina New");
    expect(screen.getByText(/Selected: Nina New · \+37369123456/i)).toBeInTheDocument();
  });

  it("selects the created vehicle on the order form when one was added in the dialog", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await openCreateClientDialog(user, "Nina New");
    await user.type(screen.getByLabelText(/^Phone \*$/), "+37369123456");
    await user.click(screen.getByLabelText("Add a vehicle"));
    await user.type(screen.getByLabelText(/^Make$/), "Toyota");
    await user.type(screen.getByLabelText(/^VIN$/), "1HGBH41JXMN109186");
    await user.click(screen.getByRole("button", { name: /Add Client/i }));

    await vi.waitFor(() => expect(createVehicleMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.getByLabelText(/^Client$/)).toHaveValue("Nina New"));
    await vi.waitFor(() => {
      const vehicleSelect = screen.getByRole("combobox", { name: /Vehicle/i });
      expect(vehicleSelect).toHaveTextContent(/Toyota/i);
    });
  });

  it("keeps the typed client name when the create dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await openCreateClientDialog(user, "Nina New");
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Client$/)).toHaveValue("Nina New");
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createOrderMock).not.toHaveBeenCalled();
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
    clientsState.clients = [
      {
        id: "client-1",
        name: "Ada",
        email: "",
        phone: "+37369123456",
        address: "",
        balance: 0,
        created_at: "",
        client_type: "individual",
        tax_id: null,
        contact_person: null,
      },
    ];
    employeesState.employees = [{ id: "emp-1", name: "Ada", status: "active", role: "technician", profile_id: "user-1" }];
    employeesState.industrySlug = "home_services";

    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(
      <AddNewOrderForm
        setCreateModalOpen={setCreateModalOpen}
        searchQuery=""
        initialClientId="client-1"
        initialClientName="Ada"
      />,
    );

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
