import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Invoice, Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import type { OrderAttachment } from "../orders/orderAttachments";
import ClientDetailPanel from "./ClientDetailPanel";
import { clientOrderSummaries, type ClientOrderSummary } from "./clientOrders";
import { resetClientDetailTabSession, writeClientDetailTab, type ClientDetailTab } from "./clientDetailTabs";
import { computeClientSettlement } from "./clientSettlement";

const mutateAsync = vi.hoisted(() => vi.fn());

const testState = vi.hoisted(() => ({
  slug: "auto_repair",
  canWrite: true,
  payments: [] as unknown[],
  invoices: [] as unknown[],
  invoiceQueryEnabled: [] as boolean[],
  attachments: [] as unknown[],
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: testState.payments, isLoading: false }),
}));

vi.mock("../invoices/useGetInvoices", () => ({
  useGetInvoices: ({ enabled = true }: { enabled?: boolean } = {}) => {
    testState.invoiceQueryEnabled.push(enabled);
    return { invoices: enabled ? testState.invoices : [], isLoading: false, error: null, refetch: vi.fn(), isUnavailable: false };
  },
  useGetInvoice: () => ({ invoice: undefined, isLoading: false, error: null }),
}));

vi.mock("../invoices/InvoiceDetailPanel", () => ({
  InvoiceDetailPanel: ({ invoiceId }: { invoiceId: string | null }) =>
    invoiceId ? <div data-testid="invoice-detail-stub">{invoiceId}</div> : null,
}));

vi.mock("../../services/apiOrderAttachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/apiOrderAttachments")>()),
  listOrderAttachmentsForOrders: vi.fn(async () => testState.attachments),
}));

vi.mock("../../services/apiClients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/apiClients")>()),
  getClients: vi.fn(async () => []),
}));

vi.mock("../../services/apiVehicles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/apiVehicles")>()),
  getClientVehicles: vi.fn(async () => []),
}));

vi.mock("./useUpdateClient", () => ({
  useUpdateClient: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(testState.slug);
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        industrySlug: testState.slug,
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const clientVehiclesState = vi.hoisted(() => ({
  vehicles: [] as {
    id: string;
    workspaceId: string;
    clientId: string;
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    licensePlate: string | null;
    initialMileage: number | null;
    currentMileage: number | null;
    mileageUnit: "km" | "mi" | null;
    engineDisplacement: number | null;
    fuelType: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }[],
}));

const clientOrdersCountState = vi.hoisted(() => ({
  count: null as number | null,
}));

vi.mock("./useClientOrdersCount", () => ({
  useClientOrdersCount: () => ({
    count: clientOrdersCountState.count,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  clientOrdersCountQueryKey: (workspaceId: string | undefined, clientId: string) => [
    "orders",
    workspaceId,
    "client-count",
    clientId,
  ],
}));

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({
    vehicles: clientVehiclesState.vehicles,
    isLoading: false,
    isError: false,
    isFetched: true,
  }),
  clientVehiclesQueryKey: (workspaceId: string | undefined, clientId: string) => ["vehicles", workspaceId, clientId],
}));

vi.mock("../vehicles/useVehicleMutations", () => ({
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => {},
  useWorkspaceSubscription: () => ({ canWrite: testState.canWrite }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

const client: Client = {
  id: "client-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+37361111111",
  address: "Chisinau",
  balance: 0,
  created_at: "2024-07-01T10:00:00.000Z",
  notes: "Prefers morning visits",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const history: ClientOrderSummary[] = [
  {
    id: "order-2",
    orderNumber: "ORD-2026-002",
    device: "BMW",
    vin: "",
    carNumber: "ABC123",
    service: "Tires",
    totalPrice: 80,
    status: "in-progress",
    isPaid: false,
    createdAt: "2026-10-02",
  },
  {
    id: "order-1",
    orderNumber: "ORD-2026-001",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil change",
    totalPrice: 40,
    isPaid: true,
    status: "completed",
    createdAt: "2026-09-01",
  },
];

function makeOrder(partial: Partial<Order> & { id: string }): Order {
  return {
    clientId: "client-1",
    clientName: "Ada Lovelace",
    orderNumber: partial.id.toUpperCase(),
    device: "",
    vin: "",
    carNumber: "",
    description: "",
    service: "",
    services: [],
    materials: [],
    status: "in-progress",
    totalPrice: 0,
    isPaid: false,
    createdAt: "2026-01-01",
    deadline: "",
    assignedEmployeeName: "",
    ...partial,
  } as unknown as Order;
}

function vehicle(id: string, make: string, model: string) {
  return {
    id,
    workspaceId: "ws-1",
    clientId: "client-1",
    make,
    model,
    year: id === "veh-a" ? 2018 : 2020,
    vin: null,
    licensePlate: id === "veh-a" ? "AAA111" : "BBB222",
    initialMileage: null,
    currentMileage: null,
    mileageUnit: null,
    engineDisplacement: null,
    fuelType: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

function ledger(partial: Partial<LedgerPayment> & { id: string }): LedgerPayment {
  return {
    workspaceId: "ws-1",
    orderId: null,
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount: 0,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-10-01T10:00:00Z",
    note: "",
    createdBy: null,
    createdAt: "2026-10-01T10:00:00Z",
    ...partial,
  };
}

function invoice(partial: Partial<Invoice> & { id: string; invoiceNumber: string; clientId: string }): Invoice {
  return {
    workspaceId: "ws-1",
    clientName: "",
    device: "",
    carNumber: "",
    vin: "",
    description: "",
    subtotal: 0,
    amount: partial.total ?? 0,
    total: 0,
    status: "sent",
    dueDate: "2026-11-01",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...partial,
  };
}

function attachment(id: string, orderId: string, fileName: string): OrderAttachment {
  return {
    id,
    workspaceId: "ws-1",
    orderId,
    uploadedBy: null,
    fileName,
    storagePath: `ws-1/${orderId}/${fileName}`,
    storageProvider: "app",
    driveFileId: null,
    driveFolderId: null,
    nasPath: null,
    mimeType: "application/pdf",
    fileSize: 2048,
    createdAt: "2026-10-05T10:00:00Z",
  };
}

function renderPanel({
  onClientUpdated = vi.fn(),
  setDetailPanelOpen = vi.fn(),
  getClientOrders = () => [] as ClientOrderSummary[],
  ordersLoading = false,
  ordersError = false,
  onOpenOrder,
  onCreateOrder,
  selectedClient = client,
  workspaceOrders,
  onClientDeleted,
  tab,
}: {
  onClientUpdated?: (client: Client) => void;
  setDetailPanelOpen?: (open: boolean) => void;
  getClientOrders?: (clientId: string) => ClientOrderSummary[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  onOpenOrder?: (orderId: string) => void;
  onCreateOrder?: (client: Client, vehicleId?: string) => void;
  selectedClient?: Client;
  workspaceOrders?: Order[];
  onClientDeleted?: (clientId: string) => void;
  /** Pre-select the session tab (otherwise the first open starts on General). */
  tab?: ClientDetailTab;
} = {}) {
  if (tab) writeClientDetailTab(tab);
  const { unmount } = renderWithQuery(
    <ClientDetailPanel
      selectedClient={selectedClient}
      detailPanelOpen
      setDetailPanelOpen={setDetailPanelOpen}
      onClientUpdated={onClientUpdated}
      getClientOrders={getClientOrders}
      ordersLoading={ordersLoading}
      ordersError={ordersError}
      onOpenOrder={onOpenOrder}
      onCreateOrder={onCreateOrder}
      workspaceOrders={workspaceOrders}
      onClientDeleted={onClientDeleted}
    />,
  );

  return { setDetailPanelOpen, unmount };
}

describe("ClientDetailPanel", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    clientVehiclesState.vehicles = [];
    clientOrdersCountState.count = null;
    resetClientDetailTabSession();
    testState.slug = "auto_repair";
    testState.canWrite = true;
    testState.payments = [];
    testState.invoices = [];
    testState.invoiceQueryEnabled = [];
    testState.attachments = [];
  });

  it("opens with a description and an edit button", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderPanel();

    expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByText("View and edit this client's contact information, balance, and order history.")).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toHaveTextContent("");
    expect(editButton.querySelector("svg")).toBeInTheDocument();

    const descriptionWarnings = warn.mock.calls.filter((args) => String(args[0]).includes("Description"));
    expect(descriptionWarnings).toHaveLength(0);

    warn.mockRestore();
  });

  it("saves client edits and shows the updated name", async () => {
    const user = userEvent.setup();
    const onClientUpdated = vi.fn();
    const setDetailPanelOpen = vi.fn();
    mutateAsync.mockResolvedValue({
      ...client,
      name: "Ada Byron",
    });

    renderPanel({ onClientUpdated, setDetailPanelOpen });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Full name *");
    await user.clear(nameInput);
    await user.type(nameInput, "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        clientName: "Ada Byron",
        phone: "+37361111111",
      }),
    );
    expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty("email");
    expect(onClientUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Byron" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("shows a clear empty state when the client has no orders", async () => {
    renderPanel({ getClientOrders: () => [], tab: "orders" });

    expect(await screen.findByRole("heading", { name: "Orders (0)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orders (0)" })).toBeInTheDocument();
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Orders for this client will show up here.")).toBeInTheDocument();
  });

  it("lists order history with number, date, status, and total", async () => {
    renderPanel({ getClientOrders: () => history, tab: "orders" });

    expect(await screen.findByRole("heading", { name: "Orders (2)" })).toBeInTheDocument();
    expect(screen.getByText("ORD-2026-002")).toBeInTheDocument();
    expect(screen.getByText("2026-10-02")).toBeInTheDocument();
    expect(screen.getByText("MDL 80.00")).toBeInTheDocument();
    expect(screen.getByText("ORD-2026-001")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("opens a historical order from the client panel", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    renderPanel({ getClientOrders: () => history, onOpenOrder, tab: "orders" });

    await user.click(screen.getByRole("button", { name: /ORD-2026-002/ }));

    expect(onOpenOrder).toHaveBeenCalledExactlyOnceWith("order-2");
  });

  it("hides empty optional contact fields and notes", async () => {
    renderPanel({
      selectedClient: {
        ...client,
        email: "",
        phone: "",
        address: "",
        notes: "   ",
      },
    });

    expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByText("Contact Information")).not.toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  it("does not display client email even when present", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ada@example.com" })).not.toBeInTheDocument();
  });

  it("passes the clicked vehicle id into onCreateOrder from the vehicles section", async () => {
    const user = userEvent.setup();
    const onCreateOrder = vi.fn();
    clientVehiclesState.vehicles = [
      {
        id: "veh-a",
        workspaceId: "ws-1",
        clientId: "client-1",
        make: "Toyota",
        model: "Corolla",
        year: 2018,
        vin: null,
        licensePlate: "AAA111",
        initialMileage: null,
        currentMileage: null,
        mileageUnit: null,
        engineDisplacement: null,
        fuelType: null,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      },
      {
        id: "veh-b",
        workspaceId: "ws-1",
        clientId: "client-1",
        make: "VW",
        model: "Golf",
        year: 2020,
        vin: null,
        licensePlate: "BBB222",
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

    renderPanel({ onCreateOrder, tab: "assets" });

    await user.click(await screen.findByRole("button", { name: /Create order for Toyota Corolla 2018/i }));
    expect(onCreateOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "client-1" }), "veh-a");

    onCreateOrder.mockClear();
    await user.click(screen.getByRole("button", { name: /Create order for VW Golf 2020/i }));
    expect(onCreateOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "client-1" }), "veh-b");
  });

  describe("header", () => {
    it("shows a tap-to-call phone under the name and keeps it in General", async () => {
      renderPanel();

      const headerPhone = await screen.findByTestId("client-detail-header-phone");
      expect(headerPhone).toHaveAttribute("href", "tel:+37361111111");
      expect(screen.getAllByRole("link", { name: "+37361111111" })).toHaveLength(2);
    });

    it("omits the header phone when the client has none", async () => {
      renderPanel({ selectedClient: { ...client, phone: "" } });

      expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
      expect(screen.queryByTestId("client-detail-header-phone")).not.toBeInTheDocument();
    });
  });

  describe("general tab", () => {
    it("opens on General without the standalone settlement and delete buttons in the body", async () => {
      renderPanel();

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "General" })).toHaveAttribute("data-state", "active");

      const body = screen.getByTestId("client-detail-scroll");
      expect(within(body).getByText("Current Balance")).toBeInTheDocument();
      expect(within(body).getByText("Prefers morning visits")).toBeInTheDocument();
      expect(within(body).queryByRole("button", { name: "Mutual Settlement" })).not.toBeInTheDocument();
      expect(within(body).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      // Heavy tabs are not mounted.
      expect(screen.queryByTestId("client-documents-tab")).not.toBeInTheDocument();
      expect(screen.queryByTestId("client-payments-tab")).not.toBeInTheDocument();
    });
  });

  describe("assets tab by industry", () => {
    const deviceOrders = [
      makeOrder({ id: "d1", orderNumber: "ORD-D1", device: "iPhone 13", deviceSerial: "SN-1", deviceImei: "111", createdAt: "2026-01-01" }),
      makeOrder({ id: "d2", orderNumber: "ORD-D2", device: "iPhone 13", deviceSerial: "SN-1", deviceImei: "111", createdAt: "2026-03-01" }),
      makeOrder({ id: "d3", orderNumber: "ORD-D3", device: "Galaxy S", deviceSerial: "SN-9", deviceImei: "999", createdAt: "2026-02-01" }),
    ];
    const siteOrders = [
      makeOrder({ id: "s1", orderNumber: "ORD-S1", siteAddress: "Str. Stefan cel Mare 1", createdAt: "2026-01-01" }),
      makeOrder({ id: "s2", orderNumber: "ORD-S2", siteAddress: "Str. Stefan cel Mare 1", createdAt: "2026-02-01" }),
      makeOrder({ id: "s3", orderNumber: "ORD-S3", productDimensions: "Wardrobe 240x60", createdAt: "2026-03-01" }),
    ];

    it("auto_repair shows Vehicles with the vehicle count", async () => {
      testState.slug = "auto_repair";
      clientVehiclesState.vehicles = [vehicle("veh-a", "Toyota", "Corolla"), vehicle("veh-b", "VW", "Golf")];
      renderPanel();

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "Vehicles (2)" })).toBeInTheDocument();
    });

    it("phone_electronics_repair shows Devices derived from orders", async () => {
      testState.slug = "phone_electronics_repair";
      renderPanel({ workspaceOrders: deviceOrders, getClientOrders: (id) => clientOrderSummaries(deviceOrders, id), tab: "assets" });

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "Devices (2)" })).toHaveAttribute("data-state", "active");

      const list = screen.getByTestId("client-assets-list");
      expect(within(list).getByText("iPhone 13")).toBeInTheDocument();
      expect(within(list).getByText("S/N: SN-1")).toBeInTheDocument();
      expect(within(list).getByText("IMEI: 111")).toBeInTheDocument();
      expect(within(list).getByText("Last order: 2026-03-01 · Orders: 2")).toBeInTheDocument();
      expect(within(list).getByText("Galaxy S")).toBeInTheDocument();
    });

    it("tapping a device switches to Orders filtered by that device, and the chip clears it", async () => {
      const user = userEvent.setup();
      testState.slug = "phone_electronics_repair";
      renderPanel({
        workspaceOrders: deviceOrders,
        getClientOrders: (id) => clientOrderSummaries(deviceOrders, id),
        tab: "assets",
      });

      await user.click(await screen.findByRole("button", { name: /Show orders for iPhone 13/ }));

      const tabs = screen.getByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "Orders (3)" })).toHaveAttribute("data-state", "active");
      expect(screen.getByText("ORD-D1")).toBeInTheDocument();
      expect(screen.getByText("ORD-D2")).toBeInTheDocument();
      expect(screen.queryByText("ORD-D3")).not.toBeInTheDocument();
      expect(screen.getByTestId("client-asset-filter-chip")).toHaveTextContent("Filtered by: iPhone 13 · SN-1");

      await user.click(screen.getByRole("button", { name: "Clear filter" }));
      expect(screen.queryByTestId("client-asset-filter-chip")).not.toBeInTheDocument();
      expect(screen.getByText("ORD-D3")).toBeInTheDocument();
    });

    it("furniture_manufacturing shows Objects from site address / product dimensions", async () => {
      testState.slug = "furniture_manufacturing";
      renderPanel({ workspaceOrders: siteOrders, getClientOrders: (id) => clientOrderSummaries(siteOrders, id), tab: "assets" });

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "Objects (2)" })).toBeInTheDocument();
      const list = screen.getByTestId("client-assets-list");
      expect(within(list).getByText("Str. Stefan cel Mare 1")).toBeInTheDocument();
      expect(within(list).getByText("Wardrobe 240x60")).toBeInTheDocument();
    });

    it("home_services shows Sites", async () => {
      testState.slug = "home_services";
      renderPanel({ workspaceOrders: siteOrders, getClientOrders: (id) => clientOrderSummaries(siteOrders, id) });

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getByRole("tab", { name: "Sites (2)" })).toBeInTheDocument();
    });

    it("industries without assets hide the Assets tab entirely", async () => {
      testState.slug = "other";
      // A remembered "assets" tab must fall back to General.
      renderPanel({ tab: "assets" });

      const tabs = await screen.findByTestId("client-detail-tabs");
      expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "General",
        "Orders (0)",
        "Documents",
        "Payments",
      ]);
      expect(within(tabs).getByRole("tab", { name: "General" })).toHaveAttribute("data-state", "active");
    });
  });

  describe("orders tab search", () => {
    it("still searches vehicles and shows matching ones under the search", async () => {
      const user = userEvent.setup();
      clientVehiclesState.vehicles = [vehicle("veh-a", "Toyota", "Corolla"), vehicle("veh-b", "VW", "Golf")];
      renderPanel({ getClientOrders: () => history, onCreateOrder: vi.fn(), tab: "orders" });

      // No vehicles list on Orders until a search matches vehicles.
      expect(screen.queryByText(/Toyota Corolla/)).not.toBeInTheDocument();

      await user.type(screen.getByRole("searchbox"), "Golf");

      expect(await screen.findByTestId("client-card-search-count")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Create order for VW Golf 2020/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Create order for Toyota Corolla/i })).not.toBeInTheDocument();
    });
  });

  describe("orders total count", () => {
    const mixedStatusHistory: ClientOrderSummary[] = [
      { ...history[0]!, id: "o-new", orderNumber: "ORD-N", status: "new", createdAt: "2026-10-10" },
      { ...history[0]!, id: "o-prog", orderNumber: "ORD-P", status: "in-progress", createdAt: "2026-10-09" },
      { ...history[0]!, id: "o-wait", orderNumber: "ORD-W", status: "waiting-parts", createdAt: "2026-10-08" },
      { ...history[1]!, id: "o-done", orderNumber: "ORD-C", status: "completed", createdAt: "2026-10-07" },
      { ...history[1]!, id: "o-paid", orderNumber: "ORD-PA", status: "paid", isPaid: true, createdAt: "2026-10-06" },
      { ...history[1]!, id: "o-closed", orderNumber: "ORD-CL", status: "closed", createdAt: "2026-10-05" },
      { ...history[1]!, id: "o-cancel", orderNumber: "ORD-X", status: "cancelled", createdAt: "2026-10-04" },
    ];

    it("shows Orders (n) for a client with multiple orders across statuses", async () => {
      clientOrdersCountState.count = 7;
      renderPanel({ getClientOrders: () => mixedStatusHistory, tab: "orders" });

      expect(await screen.findByRole("heading", { name: "Orders (7)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Orders (7)" })).toBeInTheDocument();
    });

    it("shows Orders (0) when the client has no orders", async () => {
      clientOrdersCountState.count = 0;
      renderPanel({ getClientOrders: () => [], tab: "orders" });

      expect(await screen.findByRole("heading", { name: "Orders (0)" })).toBeInTheDocument();
    });

    it("counts only the selected client's orders (workspace isolation via client_id)", async () => {
      const forClient = (clientId: string) =>
        clientId === "client-1" ? history : [{ ...history[0]!, id: "other-1", orderNumber: "ORD-OTHER" }];
      clientOrdersCountState.count = 2;
      renderPanel({ getClientOrders: forClient, tab: "orders" });

      expect(await screen.findByRole("heading", { name: "Orders (2)" })).toBeInTheDocument();
      expect(screen.queryByText("ORD-OTHER")).not.toBeInTheDocument();
      expect(screen.getByText("ORD-2026-002")).toBeInTheDocument();
    });

    it("keeps the total unchanged while card search filters the visible list", async () => {
      const user = userEvent.setup();
      clientOrdersCountState.count = 2;
      renderPanel({ getClientOrders: () => history, tab: "orders" });

      expect(await screen.findByRole("heading", { name: "Orders (2)" })).toBeInTheDocument();
      await user.type(screen.getByRole("searchbox"), "ORD-2026-002");

      await waitFor(() => {
        expect(screen.queryByText("ORD-2026-001")).not.toBeInTheDocument();
      });
      expect(screen.getByText("ORD-2026-002")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Orders (2)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Orders (2)" })).toBeInTheDocument();
    });

    it("refreshes the count after create, delete, and client reassignment", async () => {
      clientOrdersCountState.count = 2;
      const { unmount } = renderPanel({ getClientOrders: () => history, tab: "orders" });
      expect(await screen.findByRole("heading", { name: "Orders (2)" })).toBeInTheDocument();
      unmount();

      // Create
      clientOrdersCountState.count = 3;
      const afterCreate = renderPanel({
        getClientOrders: () => [
          ...history,
          { ...history[0]!, id: "order-3", orderNumber: "ORD-2026-003", status: "new", createdAt: "2026-10-11" },
        ],
        tab: "orders",
      });
      expect(await screen.findByRole("heading", { name: "Orders (3)" })).toBeInTheDocument();
      afterCreate.unmount();

      // Delete
      clientOrdersCountState.count = 1;
      const afterDelete = renderPanel({ getClientOrders: () => [history[0]!], tab: "orders" });
      expect(await screen.findByRole("heading", { name: "Orders (1)" })).toBeInTheDocument();
      afterDelete.unmount();

      // Reassigned away from this client
      clientOrdersCountState.count = 0;
      renderPanel({ getClientOrders: () => [], tab: "orders" });
      expect(await screen.findByRole("heading", { name: "Orders (0)" })).toBeInTheDocument();
    });

    it("does not show a count when no client is selected", async () => {
      clientOrdersCountState.count = 99;
      renderPanel({ selectedClient: null as unknown as Client, tab: "orders" });

      expect(screen.queryByRole("heading", { name: /Orders \(\d+\)/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /Orders/ })).not.toBeInTheDocument();
    });
  });

  describe("payments tab", () => {
    it("summary totals equal computeClientSettlement and payments list newest first", async () => {
      const balanceClient = { ...client, balance: 25 };
      testState.payments = [
        ledger({ id: "p-old", orderId: "order-1", amount: 40, paymentMethod: "card", paidAt: "2026-09-02T10:00:00Z" }),
        ledger({ id: "p-new", orderId: "order-2", amount: 30, paymentMethod: "cash", paidAt: "2026-10-03T10:00:00Z" }),
        ledger({ id: "p-other", orderId: "someone-else", amount: 999, paidAt: "2026-10-04T10:00:00Z" }),
      ];
      renderPanel({ selectedClient: balanceClient, getClientOrders: () => history, tab: "payments" });

      const expected = computeClientSettlement(history, 25, testState.payments as LedgerPayment[]);
      expect(expected).toMatchObject({ displayedOrderTotal: 80, displayedPaid: 30, totalOutstanding: 50, finalBalance: -25 });

      const summary = await screen.findByTestId("client-payments-summary");
      expect(within(summary).getByText(`MDL ${expected.existingBalance.toFixed(2)}`)).toBeInTheDocument();
      expect(within(summary).getByText(`MDL ${expected.displayedOrderTotal.toFixed(2)}`)).toBeInTheDocument();
      expect(within(summary).getByText(`MDL ${expected.displayedPaid.toFixed(2)}`)).toBeInTheDocument();
      expect(within(summary).getByText(`MDL ${expected.totalOutstanding.toFixed(2)}`)).toBeInTheDocument();
      expect(within(summary).getByText(`MDL ${expected.finalBalance.toFixed(2)}`)).toBeInTheDocument();

      const rows = within(screen.getByTestId("client-payments-list")).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("2026-10-03");
      expect(rows[0]).toHaveTextContent("Order ORD-2026-002 · Cash");
      expect(rows[0]).toHaveTextContent("+MDL 30.00");
      expect(rows[1]).toHaveTextContent("2026-09-02");
      expect(rows[1]).toHaveTextContent("Card");
    });

    it("opens the settlement dialog from the payments tab", async () => {
      const user = userEvent.setup();
      renderPanel({ getClientOrders: () => history, tab: "payments" });

      const summary = await screen.findByTestId("client-payments-summary");
      await user.click(within(summary).getByRole("button", { name: "Mutual Settlement" }));
      expect(await screen.findByText("Client Account Settlement")).toBeInTheDocument();
    });
  });

  describe("documents tab", () => {
    it("does not touch invoices until the Documents tab is open, then lists the client's invoices", async () => {
      const user = userEvent.setup();
      testState.invoices = [
        invoice({ id: "inv-a", invoiceNumber: "INV-001", clientId: "client-1", orderNumber: "ORD-2026-002", total: 80, createdAt: "2026-10-03" }),
        invoice({ id: "inv-b", invoiceNumber: "INV-999", clientId: "client-2", total: 10, createdAt: "2026-10-04" }),
        invoice({
          id: "inv-payer",
          invoiceNumber: "INV-PAY",
          clientId: "client-2",
          payerClientId: "client-1",
          orderNumber: "ORD-OTHER",
          total: 50,
          createdAt: "2026-10-05",
        }),
      ];
      renderPanel({ getClientOrders: () => history });

      await screen.findByTestId("client-detail-tabs");
      expect(testState.invoiceQueryEnabled).toEqual([]);

      await user.click(screen.getByRole("tab", { name: "Documents" }));

      expect(await screen.findByText("INV-001")).toBeInTheDocument();
      expect(screen.getByText("INV-PAY")).toBeInTheDocument();
      expect(screen.queryByText("INV-999")).not.toBeInTheDocument();
      expect(screen.getByText("2026-10-03 · Order ORD-2026-002")).toBeInTheDocument();
      expect(testState.invoiceQueryEnabled).toContain(true);

      await user.click(screen.getByRole("button", { name: /INV-001/ }));
      expect(await screen.findByTestId("invoice-detail-stub")).toHaveTextContent("inv-a");
    });

    it("groups order files by order", async () => {
      testState.attachments = [attachment("att-1", "order-2", "estimate.pdf"), attachment("att-2", "order-1", "act.pdf")];
      renderPanel({ getClientOrders: () => history, tab: "documents" });

      const groups = await screen.findAllByTestId("client-order-files-group");
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveTextContent("ORD-2026-002");
      expect(within(groups[0]!).getByText("estimate.pdf")).toBeInTheDocument();
      expect(groups[1]).toHaveTextContent("ORD-2026-001");
      expect(within(groups[1]!).getByText("act.pdf")).toBeInTheDocument();
      expect(screen.getByText("Order files")).toBeInTheDocument();
    });
  });

  describe("footer", () => {
    it("creates an order, closes the sheet, and opens settlement", async () => {
      const user = userEvent.setup();
      const onCreateOrder = vi.fn();
      const { setDetailPanelOpen } = renderPanel({ onCreateOrder });

      const footer = await screen.findByTestId("client-detail-footer");
      await user.click(within(footer).getByRole("button", { name: /Create Order/ }));
      expect(onCreateOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "client-1" }));

      await user.click(within(footer).getByRole("button", { name: "Mutual Settlement" }));
      expect(await screen.findByText("Client Account Settlement")).toBeInTheDocument();
      await user.keyboard("{Escape}");

      await user.click(within(footer).getByRole("button", { name: "Close" }));
      expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
    });

    it("opens the merge dialog with this client preselected", async () => {
      const user = userEvent.setup();
      vi.mocked((await import("../../services/apiClients")).getClients).mockResolvedValue([
        client,
        { ...client, id: "client-2", name: "Grace Hopper" },
      ]);
      renderPanel();

      const footer = await screen.findByTestId("client-detail-footer");
      await user.click(within(footer).getByRole("button", { name: "Actions" }));
      await user.click(await screen.findByRole("menuitem", { name: "Merge with…" }));

      expect(await screen.findByText("Merge clients")).toBeInTheDocument();
      expect(await screen.findByText("1 selected")).toBeInTheDocument();
      expect(await screen.findByRole("checkbox", { name: /Ada Lovelace/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Grace Hopper/ })).not.toBeChecked();
    });

    it("opens the delete dialog from the overflow menu", async () => {
      const user = userEvent.setup();
      renderPanel();

      const footer = await screen.findByTestId("client-detail-footer");
      await user.click(within(footer).getByRole("button", { name: "Actions" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete client" }));

      expect(await screen.findByRole("dialog", { name: "Delete client" })).toBeInTheDocument();
    });

    it("hides create, merge, and delete for read-only workspaces", async () => {
      testState.canWrite = false;
      renderPanel({ onCreateOrder: vi.fn() });

      const footer = await screen.findByTestId("client-detail-footer");
      expect(within(footer).queryByRole("button", { name: /Create Order/ })).not.toBeInTheDocument();
      expect(within(footer).queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
      expect(within(footer).getByRole("button", { name: "Mutual Settlement" })).toBeInTheDocument();
      expect(within(footer).getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("hides the tab bar and footer while editing", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(await screen.findByRole("button", { name: "Edit" }));

      expect(screen.getByLabelText("Full name *")).toBeInTheDocument();
      expect(screen.queryByTestId("client-detail-tabs")).not.toBeInTheDocument();
      expect(screen.queryByTestId("client-detail-footer")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByTestId("client-detail-footer")).toBeInTheDocument();
      expect(screen.getByTestId("client-detail-tabs")).toBeInTheDocument();
    });
  });

  it("remembers the selected tab across reopen", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(await screen.findByRole("tab", { name: "Payments" }));
    first.unmount();

    renderPanel();
    expect(await screen.findByRole("tab", { name: "Payments" })).toHaveAttribute("data-state", "active");
  });
});
