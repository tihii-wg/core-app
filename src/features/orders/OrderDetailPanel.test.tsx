import { useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee, Order } from "../../lib/types";
import OrderDetailPanel from "./OrderDetailPanel";
import { resetOrderDetailTabSession } from "./orderDetailTabs";

const updateOrderHooks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const updateOrderFieldsHooks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const unsavedConfirm = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));

const taxInvoiceHooks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const workspaceState = vi.hoisted(() => ({
  requireTaxInvoiceNumber: false,
  subscriptionStatus: "active",
  subscriptionStartedAt: null,
  subscriptionExpiresAt: null,
  subscriptionUpdatedAt: null,
}));

vi.mock("./useUpdateOrder", () => ({
  useUpdateOrder: () => ({
    mutateAsync: updateOrderHooks.mutateAsync,
    isPending: updateOrderHooks.isPending,
  }),
}));

vi.mock("./useUpdateOrderFields", () => ({
  useUpdateOrderFields: () => ({
    mutateAsync: updateOrderFieldsHooks.mutateAsync,
    isPending: updateOrderFieldsHooks.isPending,
  }),
  useUpdateOrderCustomFieldValue: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../../ui/ConfirmProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/ConfirmProvider")>();
  return { ...actual, useUnsavedChangesConfirm: () => unsavedConfirm.confirm };
});

const addLinesSearchHandlers = vi.hoisted(() => ({
  onServiceAdded: null as null | ((order: unknown, meta?: { catalogServiceId: string }) => void),
}));

vi.mock("./OrderAddLinesSearch", () => ({
  default: ({
    order,
    allowServices,
    allowMaterials,
    onOpenMaterial,
    onServiceAdded,
    focusRegistration,
  }: {
    order: { id: string };
    allowServices: boolean;
    allowMaterials: boolean;
    onOpenMaterial: (prefill: { kind: "catalog"; item: { id: string } }) => void;
    onServiceAdded: (order: unknown, meta?: { catalogServiceId: string }) => void;
    focusRegistration?: (focus: () => void) => void;
  }) => {
    addLinesSearchHandlers.onServiceAdded = onServiceAdded;
    focusRegistration?.(() => undefined);
    return (
      <div data-testid="order-add-lines-search">
        <span data-testid="order-add-lines-allow-services">{String(allowServices)}</span>
        <span data-testid="order-add-lines-allow-materials">{String(allowMaterials)}</span>
        <button
          type="button"
          data-testid="order-add-lines-open-material"
          onClick={() => onOpenMaterial({ kind: "catalog", item: { id: "item-stub" } as never })}
        >
          Open material
        </button>
        <span data-testid="order-add-lines-order">{order.id}</span>
      </div>
    );
  },
}));

const updateServiceLineMock = vi.hoisted(() =>
  vi.fn(async ({ lineId, patch }: { lineId: string; patch: { price?: number; quantity?: number } }) => ({
    id: "order-1",
    services: [
      {
        id: lineId,
        serviceId: "svc-oil",
        serviceName: "Oil change",
        price: patch.price ?? 40,
        quantity: patch.quantity ?? 1,
      },
    ],
    totalPrice: patch.price ?? 40,
  })),
);

vi.mock("./useUpdateOrderServiceLine", () => ({
  useUpdateOrderServiceLine: () => ({
    mutateAsync: updateServiceLineMock,
    isPending: false,
  }),
}));

vi.mock("./AddOrderMaterialDialog", () => ({
  default: ({
    open,
    order,
    prefill,
  }: {
    open: boolean;
    order: { id: string };
    prefill?: { kind: string } | null;
  }) =>
    open ? (
      <div data-testid="add-material-dialog-stub">
        {order.id}:{prefill?.kind ?? "none"}
      </div>
    ) : null,
}));

vi.mock("./useDeleteOrder", () => ({
  useDeleteOrder: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("./useGetOrders", () => ({
  useGetOrders: () => ({ orders: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateOrderTaxInvoiceNumber: () => ({
    mutateAsync: taxInvoiceHooks.mutateAsync,
    isPending: taxInvoiceHooks.isPending,
  }),
  useUpdateOrderStatus: () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  }),
}));


vi.mock("./useCloseOrder", () => ({
  useCloseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("./WarrantyOrderSection", () => ({
  default: () => null,
  WarrantyOrderSection: () => null,
}));

vi.mock("./OrderWarrantyCoverageSection", () => ({
  OrderWarrantyCoverageSection: () => null,
}));

vi.mock("./OrderFeedSection", () => ({
  default: ({ layout }: { layout?: string }) => (
    <div data-testid="order-feed-stub" data-feed-layout={layout ?? "panel"} />
  ),
}));

vi.mock("./useOrderFeed", () => ({
  useGetOrderComments: () => ({ comments: [{ id: "c1" }, { id: "c2" }], isUnavailable: false, isLoading: false, isError: false }),
  useGetOrderEvents: () => ({ events: [{ id: "e1" }], isUnavailable: false, isLoading: false, isError: false }),
  useCreateOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: {
      currency: "MDL",
      requireTaxInvoiceNumber: workspaceState.requireTaxInvoiceNumber,
      subscriptionStatus: workspaceState.subscriptionStatus,
      subscriptionStartedAt: workspaceState.subscriptionStartedAt,
      subscriptionExpiresAt: workspaceState.subscriptionExpiresAt,
      subscriptionUpdatedAt: workspaceState.subscriptionUpdatedAt,
    },
    isLoading: false,
    error: null,
    isFetched: true,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
  useGetProfile: () => ({ data: { id: "user-1" }, isLoading: false }),
}));

const ownerIdState = vi.hoisted(() => ({ isOwner: true }));
const closedOrderPermState = vi.hoisted(() => ({
  ownerCanManageClosedOrders: false,
  canCancelClosed: true,
  canDeleteClosed: true,
}));

vi.mock("./useClosedOrderPermissions", () => ({
  useClosedOrderActionPermissions: () => ({
    role: "owner",
    grants: { cancelClosed: [], deleteClosed: [], closedFullAccess: [] },
    isLoading: false,
    isError: false,
    canCancelClosed: closedOrderPermState.canCancelClosed,
    canDeleteClosed: closedOrderPermState.canDeleteClosed,
    canManageClosedContent: false,
    isOwnerByOwnerId: ownerIdState.isOwner,
    ownerCanManageClosedOrders: closedOrderPermState.ownerCanManageClosedOrders,
    hasClosedFullAccess: false,
    actsAsOwnerForClosedOrders: ownerIdState.isOwner,
  }),
  useClosedOrderPermissionGrants: () => ({
    data: { cancelClosed: [], deleteClosed: [], closedFullAccess: [] },
    isLoading: false,
  }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({
    services: [{ id: "svc-tires", service_name: "Tires", service_price: 80, status: "active" }],
  }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees, error: null, isLoading: false }),
}));

const roleState = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => roleState.role,
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => ownerIdState.isOwner,
}));

vi.mock("./OrderAttachmentsSection", () => ({
  default: () => <div data-testid="order-attachments-stub" />,
}));

vi.mock("./useOrderAttachments", () => ({
  useOrderAttachments: () => ({
    attachments: [],
    isLoading: false,
    isFetching: false,
    isFetched: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCanMutateOrderAttachments: () => true,
  useUploadOrderAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteOrderAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrderAttachmentUrl: () => ({ url: null, isLoading: false }),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false, error: null, isUnavailable: false, refetch: vi.fn() }),
  useRecordPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordRefund: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordPaymentVoid: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFullyVoidedPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../finance/PaymentHistorySection", () => ({
  PaymentHistorySection: () => <div data-testid="payment-history-stub" />,
}));

vi.mock("../finance/OrderPaymentStagesSection", () => ({
  OrderPaymentStagesSection: () => <div data-testid="payment-stages-stub" />,
}));

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({
    vehicles: linkedVehicleState.vehicle ? [linkedVehicleState.vehicle] : [],
    isLoading: false,
    isError: false,
  }),
  clientVehiclesQueryKey: (workspaceId: string | undefined, clientId: string) => ["vehicles", workspaceId, clientId],
}));

vi.mock("../vehicles/useVehicleMutations", () => ({
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const linkedVehicleState = vi.hoisted(() => ({
  vehicle: null as {
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
    mileageUnit: 'km' | 'mi' | null;
    engineDisplacement: number | null;
    fuelType: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  } | null,
}));

vi.mock("../vehicles/useGetVehicle", () => ({
  useGetVehicle: (vehicleId: string | null | undefined) => ({
    vehicle: vehicleId ? linkedVehicleState.vehicle : null,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    notFound: Boolean(vehicleId && !linkedVehicleState.vehicle),
    refetch: vi.fn(),
  }),
  vehicleQueryKey: (workspaceId: string | undefined, vehicleId: string) => ["vehicles", workspaceId, "id", vehicleId],
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isEntitlementPending: false }),
  useGuardSubscriptionWrite: () => vi.fn(),
}));

const industryState = vi.hoisted(() => ({ slug: "auto_repair" as string }));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  const cache = new Map<string, ReturnType<typeof industryWorkflow>>();
  return {
    useIndustryWorkflow: () => {
      const slug = industryState.slug;
      let workflow = cache.get(slug);
      if (!workflow) {
        workflow = industryWorkflow(slug);
        cache.set(slug, workflow);
      }
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        profile: undefined,
        industrySlug: slug,
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  clientPhone: "+37361111111",
  orderNumber: "ORD-2026-003",
  vehicleId: "veh-1",
  device: "BMW",
  vin: "1HGBH41JXMN109186",
  carNumber: "ABC123",
  service: "Oil change",
  services: [{ id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 }],
  materials: [],
  description: "Noise",
  status: "new",
  assignedEmployeeId: "emp-1",
  assignedEmployeeName: "Ada Tech",
  deadline: "2026-10-01",
  totalPrice: 40,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
};

const employees: Employee[] = [
  {
    id: "emp-1",
    name: "Ada Tech",
    email: "ada@example.com",
    phone: "+37361111111",
    role: "technician",
    status: "active",
    assignedTasks: 0,
    completedTasks: 0,
    profile_id: "user-1",
  },
  {
    id: "emp-2",
    name: "Bob Tech",
    email: "bob@example.com",
    phone: "+37362222222",
    role: "technician",
    status: "active",
    assignedTasks: 0,
    completedTasks: 0,
    profile_id: null,
  },
];

function renderPanel(
  onOrderUpdated = vi.fn(),
  setDetailPanelOpen = vi.fn(),
  overrides: { order?: Order; isStatusUpdating?: boolean; onStatusChange?: (status: string) => void } = {},
) {
  industryState.slug = industryState.slug || "auto_repair";
  renderWithQuery(
    <OrderDetailPanel
      selectedOrder={overrides.order ?? order}
      detailPanelOpen
      setDetailPanelOpen={setDetailPanelOpen}
      onOrderUpdated={onOrderUpdated}
      onStatusChange={overrides.onStatusChange ?? vi.fn()}
      isStatusUpdating={overrides.isStatusUpdating}
    />,
  );

  return { setDetailPanelOpen };
}

beforeEach(() => {
  resetOrderDetailTabSession();
  industryState.slug = "auto_repair";
  roleState.role = "owner";
  ownerIdState.isOwner = true;
  closedOrderPermState.ownerCanManageClosedOrders = false;
  closedOrderPermState.canCancelClosed = true;
  closedOrderPermState.canDeleteClosed = true;
  updateOrderHooks.isPending = false;
  updateOrderHooks.mutateAsync.mockReset();
  updateOrderFieldsHooks.isPending = false;
  updateOrderFieldsHooks.mutateAsync.mockReset();
  updateServiceLineMock.mockReset();
  addLinesSearchHandlers.onServiceAdded = null;
  unsavedConfirm.confirm.mockReset();
  unsavedConfirm.confirm.mockResolvedValue(true);
  taxInvoiceHooks.isPending = false;
  taxInvoiceHooks.mutateAsync.mockReset();
  workspaceState.requireTaxInvoiceNumber = false;
  linkedVehicleState.vehicle = {
    id: "veh-1",
    workspaceId: "ws-1",
    clientId: "client-1",
    make: "Toyota",
    model: "Corolla",
    year: 2018,
    vin: "1HGBH41JXMN109186",
    licensePlate: "ABC123",
    initialMileage: 12000,
    currentMileage: 45000,
    mileageUnit: null,
    engineDisplacement: 2,
    fuelType: "diesel",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
});

describe("OrderDetailPanel", () => {
  it("opens with a description and a pencil button", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderPanel();

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.getByText("View and edit this order's VIN, services, vehicle, assignment, and deadline.")).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toHaveTextContent("");
    expect(editButton.querySelector("svg")).toBeInTheDocument();

    const descriptionWarnings = warn.mock.calls.filter((args) => String(args[0]).includes("Description"));
    expect(descriptionWarnings).toHaveLength(0);

    warn.mockRestore();
  });

  it("shows click-to-edit fields on an open order and opens the description editor inline", async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByRole("button", { name: /Edit: Deadline/i })).toBeInTheDocument();
    // The description moved to the «Services & materials» tab (under the search field).
    expect(screen.queryByRole("button", { name: "Edit: Description" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Services & materials/i }));
    // Services / materials stay non-inline: no per-field pencil on the idle view.
    expect(screen.queryByRole("button", { name: "Edit: Services" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit: Materials" })).not.toBeInTheDocument();

    const descriptionField = await screen.findByRole("button", { name: "Edit: Description" });
    expect(descriptionField).toHaveTextContent("Noise");
    await user.click(descriptionField);

    const editor = await screen.findByRole("textbox", { name: "Description" });
    expect(editor).toHaveValue("Noise");
    await waitFor(() => expect(editor).toHaveFocus());
    // Inline editing never swaps the card for the full form.
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("renders closed-order fields as plain text, not buttons", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt: "2026-11-05T14:59:54.258807+00:00" },
    });

    expect(await screen.findByText("Order closed")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit: Description" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit: / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("saves the description inline without calling the full order update", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const saved = { ...order, description: "Brake noise" };
    updateOrderFieldsHooks.mutateAsync.mockResolvedValue(saved);

    renderPanel(onOrderUpdated);

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    const editor = await screen.findByRole("textbox", { name: "Description" });
    await user.clear(editor);
    await user.type(editor, "Brake noise");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateOrderFieldsHooks.mutateAsync).toHaveBeenCalledWith({
        orderId: "order-1",
        patch: { description: "Brake noise" },
      });
    });
    expect(onOrderUpdated).toHaveBeenCalledWith(saved);
    expect(updateOrderHooks.mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Description" })).not.toBeInTheDocument());
  });

  it("keeps the editor open and shows the error under the control when the save fails", async () => {
    const user = userEvent.setup();
    updateOrderFieldsHooks.mutateAsync.mockRejectedValue(new Error("Order is closed"));

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    const editor = await screen.findByRole("textbox", { name: "Description" });
    await user.type(editor, " more");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Order is closed");
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });

  it("asks before discarding a dirty inline field when another field is opened", async () => {
    const user = userEvent.setup();
    unsavedConfirm.confirm.mockResolvedValueOnce(false);

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await user.type(await screen.findByRole("textbox", { name: "Description" }), " draft");

    await user.click(screen.getByRole("button", { name: /Edit: Deadline/i }));
    expect(unsavedConfirm.confirm).toHaveBeenCalledTimes(1);
    // Kept editing: description draft still open, deadline untouched.
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Noise draft");
    expect(screen.getByRole("button", { name: /Edit: Deadline/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit: Deadline/i }));
    expect(unsavedConfirm.confirm).toHaveBeenCalledTimes(2);
    // Discarded: only one editor is open at a time.
    expect(await screen.findByLabelText(/Deadline/i)).toHaveAttribute("type", "date");
    expect(screen.queryByRole("textbox", { name: "Description" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit: Description" })).toHaveTextContent("Noise");
  });

  it("switches fields without a prompt when the open field is clean", async () => {
    const user = userEvent.setup();

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await screen.findByRole("textbox", { name: "Description" });
    await user.click(screen.getByRole("button", { name: /Edit: Deadline/i }));

    expect(unsavedConfirm.confirm).not.toHaveBeenCalled();
    expect(await screen.findByLabelText(/Deadline/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Description" })).not.toBeInTheDocument();
  });

  it("confirms before closing the sheet with a dirty inline field", async () => {
    const user = userEvent.setup();
    const setDetailPanelOpen = vi.fn();
    unsavedConfirm.confirm.mockResolvedValueOnce(false);

    renderPanel(vi.fn(), setDetailPanelOpen);

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await user.type(await screen.findByRole("textbox", { name: "Description" }), " draft");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(unsavedConfirm.confirm).toHaveBeenCalledTimes(1);
    expect(setDetailPanelOpen).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(setDetailPanelOpen).toHaveBeenCalledWith(false));
  });

  it("closes the sheet without a prompt when the inline field is not dirty", async () => {
    const user = userEvent.setup();
    const setDetailPanelOpen = vi.fn();

    renderPanel(vi.fn(), setDetailPanelOpen);

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await screen.findByRole("textbox", { name: "Description" });
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(unsavedConfirm.confirm).not.toHaveBeenCalled();
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("shows click-to-add placeholders for empty visible fields when editable", async () => {
    industryState.slug = "phone_electronics_repair";
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, vehicleId: null, description: "", deadline: "", deviceSerial: "", devicePasscode: "" },
    });

    expect(await screen.findByRole("button", { name: "Edit: Description" })).toHaveTextContent(
      "+ Add",
    );
    expect(screen.getByRole("button", { name: /Edit: Deadline/i })).toHaveTextContent("+ Add");
    expect(screen.getByTestId("inline-field-deviceSerial")).toHaveTextContent("+ Add");
    expect(screen.getByRole("button", { name: "Edit: Passcode / pattern" })).toHaveTextContent("+ Add");
  });

  it("saves the deadline inline as a date patch", async () => {
    const user = userEvent.setup();
    updateOrderFieldsHooks.mutateAsync.mockResolvedValue({ ...order, deadline: "2026-12-24" });

    renderPanel();

    await user.click(await screen.findByRole("button", { name: /Edit: Deadline/i }));
    const input = await screen.findByLabelText(/Deadline/i);
    expect(input).toHaveValue("2026-10-01");
    await user.clear(input);
    await user.type(input, "2026-12-24");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(updateOrderFieldsHooks.mutateAsync).toHaveBeenCalledWith({
        orderId: "order-1",
        patch: { deadline: "2026-12-24" },
      });
    });
  });

  it("makes only the order visit mileage inline-editable in the vehicle block", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, vehicleMileageSnapshot: 85500, vehicleMileageUnitSnapshot: "km" },
    });

    const linked = await screen.findByTestId("order-linked-vehicle");
    const editButtons = within(linked).getAllByRole("button", { name: /^Edit: / });
    expect(editButtons).toHaveLength(1);
    expect(editButtons[0]).toHaveTextContent(/85,?500/);
    // Make / model / VIN etc. are plain values that open the vehicle card.
    expect(within(linked).getByRole("button", { name: "Toyota" })).toHaveAttribute("title", "View vehicle details");
  });

  it("saves order edits and closes the details window without clearing stored vehicle assets", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const setDetailPanelOpen = vi.fn();
    updateOrderHooks.mutateAsync.mockResolvedValue({ ...order, description: "Updated noise" });

    renderPanel(onOrderUpdated, setDetailPanelOpen);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText(/^VIN/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/License plate/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Make and model/i)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Vehicle$/i })).toBeInTheDocument();

    const description = screen.getByLabelText(/Description/i);
    await user.clear(description);
    await user.type(description, "Updated noise");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        vehicleId: "veh-1",
        device: "BMW",
        carNumber: "ABC123",
        description: "Updated noise",
        assignedEmployeeId: "emp-1",
        vin: "1HGBH41JXMN109186",
      }),
    );
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ description: "Updated noise" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("preserves vehicle_id on save while adding a service (no order-level VIN input)", async () => {
    const user = userEvent.setup();
    updateOrderHooks.mutateAsync.mockResolvedValue(order);

    renderPanel();

    expect(screen.getByTestId("order-linked-vehicle")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Diesel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText(/^VIN/i)).not.toBeInTheDocument();
    await user.click(screen.getByPlaceholderText("Service"));
    await user.click(screen.getByRole("button", { name: /Tires/i }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: "veh-1",
        vin: "1HGBH41JXMN109186",
        carNumber: "ABC123",
        device: "BMW",
        services: [
          { id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 },
          expect.objectContaining({ serviceId: "svc-tires", serviceName: "Tires", price: 80 }),
        ],
      }),
    );
  });

  it("hides linked vehicle details when the order has no vehicle_id", async () => {
    renderPanel(vi.fn(), vi.fn(), { order: { ...order, vehicleId: null } });
    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByTestId("order-linked-vehicle")).not.toBeInTheDocument();
    expect(screen.queryByText("Toyota")).not.toBeInTheDocument();
  });

  it("preserves historical VIN and plate when editing under home_services", async () => {
    industryState.slug = "home_services";
    const user = userEvent.setup();
    updateOrderHooks.mutateAsync.mockResolvedValue(order);

    renderPanel();

    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByTestId("order-linked-vehicle")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText(/^VIN/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/License plate/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        vin: "1HGBH41JXMN109186",
        carNumber: "ABC123",
        device: "BMW",
      }),
    );

    industryState.slug = "auto_repair";
  });

  it("surfaces status, overdue deadline, assignee, contact, and service lines", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), {
      order: {
        ...order,
        services: [
          { id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 },
          { id: "line-2", serviceId: "svc-filter", serviceName: "Oil filter", price: 15, quantity: 2 },
        ],
        totalPrice: 70,
      },
    });

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.getAllByText("New").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Assigned technician/i })).toHaveTextContent("Ada Tech");
    expect(screen.getByRole("link", { name: "+37361111111" })).toHaveAttribute("href", "tel:+37361111111");
    expect(screen.queryByRole("link", { name: "ada@example.com" })).not.toBeInTheDocument();
    expect(screen.getAllByText("MDL 70.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("columnheader", { name: "Services" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Services & materials \(2\)/i }));
    expect(await screen.findByRole("columnheader", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("Oil filter")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Unassigned when no employee is assigned", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, assignedEmployeeId: "", assignedEmployeeName: "" },
    });

    expect(await screen.findByRole("combobox", { name: /Assigned technician/i })).toHaveTextContent("Unassigned");
  });

  it("reassigns the order from the details panel without opening edit", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    updateOrderHooks.mutateAsync.mockResolvedValue({
      ...order,
      assignedEmployeeId: "emp-2",
      assignedEmployeeName: "Bob Tech",
    });

    renderPanel(onOrderUpdated);

    await user.click(screen.getByRole("combobox", { name: /Assigned technician/i }));
    expect(await screen.findByRole("option", { name: "Bob Tech" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Bob Tech" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        assignedEmployeeId: "emp-2",
        device: "BMW",
        vin: "1HGBH41JXMN109186",
      }),
    );
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ assignedEmployeeName: "Bob Tech" }));
  });

  it("disables assignee changes while saving", async () => {
    updateOrderHooks.isPending = true;
    renderPanel();

    expect(await screen.findByRole("combobox", { name: /Assigned technician/i })).toBeDisabled();
  });

  it("hides empty optional fields instead of placeholder dashes when the order is read-only", async () => {
    const sparse: Order = {
      ...order,
      status: "closed",
      closedAt: "2026-11-05T14:59:54.258807+00:00",
      clientType: null,
      clientEmail: "",
      clientPhone: "",
      assignedEmployeeId: "",
      assignedEmployeeName: "",
      deadline: "",
      description: "",
      vin: "",
      carNumber: "",
      device: "BMW",
      services: [],
      service: "",
      // No linked vehicle — empty vehicle fields would otherwise render "—" placeholders.
      vehicleId: null,
    };

    renderPanel(vi.fn(), vi.fn(), { order: sparse });

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Assigned technician/i })).toHaveTextContent("Unassigned");
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.queryByText("Services")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("disables the status control while a status update is in flight", async () => {
    renderPanel(vi.fn(), vi.fn(), { isStatusUpdating: true });

    expect(await screen.findByRole("combobox", { name: /Update Status/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /Assigned technician/i })).toBeDisabled();
  });

  it("disables the status selector for Paid orders when the actor is not the workspace owner", async () => {
    roleState.role = "admin";
    const onStatusChange = vi.fn();
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "paid", isPaid: true, paymentStatus: "paid" },
      onStatusChange,
    });

    expect(await screen.findByRole("combobox", { name: /Status locked/i })).toBeDisabled();
    expect(screen.getByText(/Only the workspace owner can change/i)).toBeInTheDocument();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("lets the workspace owner change status on a Paid order from the detail selector", async () => {
    const user = userEvent.setup();
    roleState.role = "owner";
    const onStatusChange = vi.fn();
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "paid", isPaid: true, paymentStatus: "paid" },
      onStatusChange,
    });

    expect(await screen.findByRole("combobox", { name: /Update Status/i })).toBeEnabled();
    expect(screen.queryByText(/Only the workspace owner can change/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /Update Status/i }));
    await user.click(await screen.findByRole("option", { name: "In Progress" }));

    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith("in-progress");
  });

  it("shows a saved tax invoice number for a legal-entity order and keeps it after the order is marked paid", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const onStatusChange = vi.fn();
    workspaceState.requireTaxInvoiceNumber = true;
    taxInvoiceHooks.mutateAsync.mockResolvedValue("FV-2026-77");

    const legalOrder: Order = {
      ...order,
      clientType: "organization",
      taxInvoiceNumber: "",
      status: "completed",
    };

    const { rerender } = renderWithQuery(
      <OrderDetailPanel
        selectedOrder={legalOrder}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={onOrderUpdated}
        onStatusChange={onStatusChange}
      />,
    );

    const input = await screen.findByLabelText("Tax invoice number");
    expect(input).toHaveValue("");
    await user.type(input, "FV-2026-77");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(taxInvoiceHooks.mutateAsync).toHaveBeenCalledWith({ orderId: "order-1", taxInvoiceNumber: "FV-2026-77" });
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ taxInvoiceNumber: "FV-2026-77" }));

    // Simulate parent keeping the saved number while marking the order paid (status update must not clear it).
    const paidOrder: Order = {
      ...legalOrder,
      taxInvoiceNumber: "FV-2026-77",
      status: "paid",
      isPaid: true,
      paymentStatus: "paid",
    };
    rerender(
      <OrderDetailPanel
        selectedOrder={paidOrder}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={onOrderUpdated}
        onStatusChange={onStatusChange}
      />,
    );

    expect(screen.getByLabelText("Tax invoice number")).toHaveValue("FV-2026-77");
  });

  it("redisplays the persisted tax invoice number when the same legal-entity order is reopened", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    const legalOrder: Order = {
      ...order,
      clientType: "organization",
      taxInvoiceNumber: "FV-PERSISTED",
      status: "paid",
      isPaid: true,
      paymentStatus: "paid",
    };

    const { rerender } = renderWithQuery(
      <OrderDetailPanel
        selectedOrder={legalOrder}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText("Tax invoice number")).toHaveValue("FV-PERSISTED");
    expect(screen.queryByText(/tax invoice number is required/i)).not.toBeInTheDocument();

    // Close then reopen with the same persisted payload (as after navigation/refresh).
    rerender(
      <OrderDetailPanel
        selectedOrder={legalOrder}
        detailPanelOpen={false}
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );
    rerender(
      <OrderDetailPanel
        selectedOrder={{ ...legalOrder }}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Tax invoice number");
    expect(input).toHaveValue("FV-PERSISTED");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/tax invoice number is required/i)).not.toBeInTheDocument();
  });

  it("keeps a saved tax invoice number after save → close → reopen and after a refetch payload", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    workspaceState.requireTaxInvoiceNumber = true;
    taxInvoiceHooks.mutateAsync.mockResolvedValue("FV-REFETCH-9");

    let selected: Order = {
      ...order,
      clientType: "organization",
      taxInvoiceNumber: "",
      status: "completed",
    };

    const { rerender } = renderWithQuery(
      <OrderDetailPanel
        selectedOrder={selected}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={(next) => {
          selected = next;
          onOrderUpdated(next);
        }}
        onStatusChange={vi.fn()}
      />,
    );

    const input = await screen.findByLabelText("Tax invoice number");
    expect(input).toHaveAttribute("aria-invalid");
    await user.type(input, "FV-REFETCH-9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ taxInvoiceNumber: "FV-REFETCH-9" }));

    // Close panel.
    rerender(
      <OrderDetailPanel
        selectedOrder={selected}
        detailPanelOpen={false}
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={onOrderUpdated}
        onStatusChange={vi.fn()}
      />,
    );

    // Reopen with the saved order (as after closing the sheet).
    rerender(
      <OrderDetailPanel
        selectedOrder={{ ...selected, taxInvoiceNumber: "FV-REFETCH-9" }}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={onOrderUpdated}
        onStatusChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Tax invoice number")).toHaveValue("FV-REFETCH-9");
    expect(screen.queryByText(/tax invoice number is required/i)).not.toBeInTheDocument();

    // Simulate page reload / React Query refetch bringing the same persisted value.
    rerender(
      <OrderDetailPanel
        selectedOrder={{
          ...selected,
          taxInvoiceNumber: "FV-REFETCH-9",
          status: "paid",
          isPaid: true,
          paymentStatus: "paid",
        }}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={onOrderUpdated}
        onStatusChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Tax invoice number")).toHaveValue("FV-REFETCH-9");
    expect(screen.getByLabelText("Tax invoice number")).not.toHaveAttribute("aria-invalid");
  });

  it("still shows the required validation for a legal-entity order with no saved number", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, clientType: "organization", taxInvoiceNumber: "", status: "completed" },
    });

    const input = await screen.findByLabelText("Tax invoice number");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-invalid");
    expect(screen.getByText(/tax invoice number is required/i)).toBeInTheDocument();
  });

  it("keeps Paid disabled for a typed but unsaved tax invoice number", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    workspaceState.requireTaxInvoiceNumber = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, clientType: "organization", taxInvoiceNumber: "", status: "completed" },
      onStatusChange,
    });

    const input = await screen.findByLabelText("Tax invoice number");
    await user.type(input, "FV-DRAFT-ONLY");
    expect(taxInvoiceHooks.mutateAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: /Update Status/i }));
    const paidOption = await screen.findByRole("option", { name: "Paid" });
    expect(paidOption).toHaveAttribute("data-disabled");
    expect(screen.getByText(/Save a tax invoice number on this order before marking it as paid/i)).toBeInTheDocument();

    await user.click(paidOption);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("enables Paid only after the tax invoice number is persisted on the order", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    workspaceState.requireTaxInvoiceNumber = true;
    taxInvoiceHooks.mutateAsync.mockResolvedValue("FV-SAVED-1");

    let selected: Order = {
      ...order,
      clientType: "organization",
      taxInvoiceNumber: "",
      status: "completed",
    };

    const { rerender } = renderWithQuery(
      <OrderDetailPanel
        selectedOrder={selected}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={(next) => {
          selected = next;
        }}
        onStatusChange={onStatusChange}
      />,
    );

    await user.click(await screen.findByRole("combobox", { name: /Update Status/i }));
    expect(await screen.findByRole("option", { name: "Paid" })).toHaveAttribute("data-disabled");

    // Close the select (Escape) then save a number and re-render with the persisted order.
    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Tax invoice number"), "FV-SAVED-1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    rerender(
      <OrderDetailPanel
        selectedOrder={{ ...selected, taxInvoiceNumber: "FV-SAVED-1" }}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={(next) => {
          selected = next;
        }}
        onStatusChange={onStatusChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /Update Status/i }));
    const paidOption = await screen.findByRole("option", { name: "Paid" });
    expect(paidOption).not.toHaveAttribute("data-disabled");
    await user.click(paidOption);
    expect(onStatusChange).toHaveBeenCalledWith("paid");
  });

  it("leaves Paid blocked and shows the save error when tax invoice save fails", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    workspaceState.requireTaxInvoiceNumber = true;
    taxInvoiceHooks.mutateAsync.mockRejectedValue(new Error("Could not save the tax invoice number"));

    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, clientType: "organization", taxInvoiceNumber: "", status: "completed" },
      onStatusChange,
    });

    await user.type(await screen.findByLabelText("Tax invoice number"), "FV-FAIL");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(taxInvoiceHooks.mutateAsync).toHaveBeenCalled();
    // Order prop still has no persisted number.
    await user.click(screen.getByRole("combobox", { name: /Update Status/i }));
    expect(await screen.findByRole("option", { name: "Paid" })).toHaveAttribute("data-disabled");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("does not show the tax invoice field for individual customers", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, clientType: "individual", taxInvoiceNumber: "FV-HIDDEN" },
    });

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Tax invoice number")).not.toBeInTheDocument();
  });
});

describe("OrderDetailPanel closed-order banner", () => {
  const closedAt = "2026-11-05T14:59:54.258807+00:00";

  beforeEach(() => {
    industryState.slug = "auto_repair";
    roleState.role = "owner";
  });

  it("shows the closure banner for a currently closed order", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt },
    });
    expect(await screen.findByText("Order closed")).toBeInTheDocument();
    expect(screen.getByText(`Closed at ${closedAt}`)).toBeInTheDocument();
    expect(screen.getByTestId("closed-order-immutable-hint")).toHaveTextContent(
      "A closed order cannot be changed. To fix it, cancel the order first.",
    );
  });

  it("hides edit controls for the owner even when cancel/delete setting is on", async () => {
    closedOrderPermState.ownerCanManageClosedOrders = true;
    closedOrderPermState.canCancelClosed = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt },
    });
    expect(await screen.findByText("Order closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Edit$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Update Status/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("closed-order-immutable-hint")).toBeInTheDocument();
  });

  it("hides edit controls for members on closed orders", async () => {
    ownerIdState.isOwner = false;
    roleState.role = "member";
    closedOrderPermState.ownerCanManageClosedOrders = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt },
    });
    expect(await screen.findByText("Order closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Edit$/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("closed-order-immutable-hint")).toBeInTheDocument();
  });

  it("hides the stale closure banner after cancel while closed_at remains", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "cancelled", closedAt },
    });
    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByText("Order closed")).not.toBeInTheDocument();
    expect(screen.queryByText(`Closed at ${closedAt}`)).not.toBeInTheDocument();
  });

  it("hides the closure banner after reopen clears closed_at and shows Close Order", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "in-progress", closedAt: null },
    });
    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByText("Order closed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close order/i })).toBeInTheDocument();
  });

  it("lets the workspace owner change status on a cancelled order", async () => {
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "cancelled", closedAt },
    });
    expect(await screen.findByRole("combobox", { name: /Update Status/i })).toBeEnabled();
    expect(screen.queryByText(/Status cannot be changed here/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close order/i })).not.toBeInTheDocument();
  });

  it("keeps cancelled status locked for non-owners", async () => {
    ownerIdState.isOwner = false;
    roleState.role = "admin";
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "cancelled", closedAt },
    });
    expect(await screen.findByText(/This order is cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Update Status/i })).not.toBeInTheDocument();
  });

  it("shows the new closure banner when the order is closed again", async () => {
    const nextClosedAt = "2026-11-06T10:00:00.000Z";
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt: nextClosedAt },
    });
    expect(await screen.findByText("Order closed")).toBeInTheDocument();
    expect(screen.getByText(`Closed at ${nextClosedAt}`)).toBeInTheDocument();
  });
});

function stubViewport(minWidth1024: boolean) {
  window.matchMedia = ((query: string) => {
    const wantsDesktop = /min-width:\s*1024px/.test(query);
    return {
      matches: wantsDesktop ? minWidth1024 : !minWidth1024 && /max-width/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: minWidth1024 ? 1280 : 390,
  });
}

describe("OrderDetailPanel feed layout", () => {
  beforeEach(() => {
    resetOrderDetailTabSession();
    industryState.slug = "auto_repair";
    roleState.role = "owner";
    ownerIdState.isOwner = true;
  });

  it("keeps the feed in the right column on desktop widths", async () => {
    stubViewport(true);
    renderPanel();

    const layout = await screen.findByTestId("order-detail-main");
    expect(layout.closest("[data-order-detail-layout]")).toHaveAttribute("data-order-detail-layout", "desktop");
    expect(screen.queryByTestId("order-detail-mobile-tabs")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-detail-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-status-bar")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /History/i })).not.toBeInTheDocument();

    const feedColumn = screen.getByTestId("order-detail-feed-column");
    expect(feedColumn).toContainElement(screen.getByTestId("order-feed-stub"));
    expect(feedColumn).not.toHaveClass("hidden");
    expect(screen.getByTestId("order-detail-main")).not.toHaveClass("hidden");
  });

  it("puts the feed behind the History tab on mobile widths", async () => {
    const user = userEvent.setup();
    stubViewport(false);
    renderPanel();

    expect(await screen.findByTestId("order-detail-mobile-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-main").closest("[data-order-detail-layout]")).toHaveAttribute(
      "data-order-detail-layout",
      "mobile",
    );
    expect(screen.getByTestId("order-detail-main")).not.toHaveClass("hidden");
    expect(screen.getByTestId("order-detail-feed-column")).toHaveClass("hidden");
    expect(screen.getByRole("tab", { name: /^Information$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Services & materials/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Invoices & payments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Files$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /History \(3\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /History \(3\)/i }));

    expect(screen.getByTestId("order-detail-main")).toHaveClass("hidden");
    const feedColumn = screen.getByTestId("order-detail-feed-column");
    expect(feedColumn).not.toHaveClass("hidden");
    expect(feedColumn).toContainElement(screen.getByTestId("order-feed-stub"));
  });
});

describe("OrderDetailPanel content tabs", () => {
  beforeEach(() => {
    resetOrderDetailTabSession();
    industryState.slug = "auto_repair";
    roleState.role = "owner";
    ownerIdState.isOwner = true;
    stubViewport(true);
  });

  it("switches between info, items, payments, and files sections", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), {
      order: {
        ...order,
        services: [{ id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 }],
      },
    });

    expect(await screen.findByRole("tab", { name: /^Information$/i })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("button", { name: "Edit: Description" })).toBeInTheDocument();
    expect(screen.queryByTestId("order-attachments-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-history-stub")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Services & materials \(1\)/i }));
    expect(await screen.findByRole("columnheader", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit: Description" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Invoices & payments/i }));
    expect(await screen.findByTestId("payment-history-stub")).toBeInTheDocument();
    expect(screen.getByTestId("payment-stages-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Files$/i }));
    expect(await screen.findByTestId("order-attachments-stub")).toBeInTheDocument();
  });

  it("hides the tab bar while editing and restores the previous tab afterward", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    renderPanel();

    await user.click(await screen.findByRole("tab", { name: /Invoices & payments/i }));
    expect(screen.getByTestId("payment-history-stub")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByTestId("order-detail-tabs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-detail-status-bar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(await screen.findByTestId("order-detail-tabs")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Invoices & payments/i })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("payment-history-stub")).toBeInTheDocument();
  });

  it("uses works/materials wording for furniture industries", async () => {
    industryState.slug = "furniture_manufacturing";
    renderPanel(vi.fn(), vi.fn(), {
      order: {
        ...order,
        services: [{ id: "line-1", serviceId: "svc-1", serviceName: "Assembly", price: 10, quantity: 1 }],
      },
    });

    expect(await screen.findByRole("tab", { name: /Works & materials \(1\)/i })).toBeInTheDocument();
  });
});

describe("OrderDetailPanel sticky footer", () => {
  const closedAt = "2026-11-05T14:59:54.258807+00:00";

  beforeEach(() => {
    resetOrderDetailTabSession();
    industryState.slug = "auto_repair";
    roleState.role = "owner";
    ownerIdState.isOwner = true;
    stubViewport(true);
  });

  it("is pinned under the order column on every desktop tab and keeps lifecycle actions out of the header", async () => {
    const user = userEvent.setup();
    renderPanel();

    const footer = await screen.findByTestId("order-detail-footer");
    expect(screen.getByTestId("order-detail-main")).toContainElement(footer);
    expect(screen.getByTestId("order-detail-feed-column")).not.toContainElement(footer);
    expect(within(footer).getByRole("button", { name: "Save & close" })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Close order" })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(within(screen.getByTestId("order-detail-status-bar")).queryByRole("button", { name: /order$/i })).toBeNull();

    for (const tab of [/Services & materials/i, /Invoices & payments/i, /^Files$/i, /^Information$/i]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByTestId("order-detail-footer")).toBeInTheDocument();
    }
  });

  it("is hidden on the mobile History tab and shows an overflow menu for Cancel order on phones", async () => {
    const user = userEvent.setup();
    stubViewport(false);
    renderPanel();

    const footer = await screen.findByTestId("order-detail-footer");
    expect(within(footer).getByRole("button", { name: "Save & close" })).toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
    await user.click(within(footer).getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Cancel order" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: /History \(3\)/i }));
    expect(screen.queryByTestId("order-detail-footer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Information$/i }));
    expect(screen.getByTestId("order-detail-footer")).toBeInTheDocument();
  });

  it("saves a dirty inline field and then closes the sheet", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const saved = { ...order, description: "Brake noise" };
    updateOrderFieldsHooks.mutateAsync.mockResolvedValue(saved);
    const { setDetailPanelOpen } = renderPanel(onOrderUpdated);

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    const editor = await screen.findByRole("textbox", { name: "Description" });
    await user.clear(editor);
    await user.type(editor, "Brake noise");
    await user.click(within(screen.getByTestId("order-detail-footer")).getByRole("button", { name: "Save & close" }));

    await waitFor(() => {
      expect(updateOrderFieldsHooks.mutateAsync).toHaveBeenCalledWith({
        orderId: "order-1",
        patch: { description: "Brake noise" },
      });
    });
    expect(onOrderUpdated).toHaveBeenCalledWith(saved);
    await waitFor(() => expect(setDetailPanelOpen).toHaveBeenCalledWith(false));
    expect(updateOrderHooks.mutateAsync).not.toHaveBeenCalled();
  });

  it("stays open and shows the error under the field when the save fails", async () => {
    const user = userEvent.setup();
    updateOrderFieldsHooks.mutateAsync.mockRejectedValue(new Error("Order is closed"));
    const { setDetailPanelOpen } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await user.type(await screen.findByRole("textbox", { name: "Description" }), " more");
    await user.click(within(screen.getByTestId("order-detail-footer")).getByRole("button", { name: "Save & close" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Order is closed");
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(setDetailPanelOpen).not.toHaveBeenCalled();
  });

  it("just closes the sheet when no field is open", async () => {
    const user = userEvent.setup();
    const { setDetailPanelOpen } = renderPanel();

    await user.click(within(await screen.findByTestId("order-detail-footer")).getByRole("button", { name: "Save & close" }));

    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
    expect(updateOrderFieldsHooks.mutateAsync).not.toHaveBeenCalled();
  });

  it("submits the edit form from the footer and then closes the sheet", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    updateOrderHooks.mutateAsync.mockResolvedValue({ ...order, description: "Updated noise" });
    const { setDetailPanelOpen } = renderPanel(onOrderUpdated);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const description = screen.getByLabelText(/Description/i);
    await user.clear(description);
    await user.type(description, "Updated noise");
    await user.click(within(screen.getByTestId("order-detail-footer")).getByRole("button", { name: "Save & close" }));

    await waitFor(() =>
      expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: "order-1", description: "Updated noise" }),
      ),
    );
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ description: "Updated noise" }));
    await waitFor(() => expect(setDetailPanelOpen).toHaveBeenCalledWith(false));
    expect(setDetailPanelOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the edit form open when the footer submit fails", async () => {
    const user = userEvent.setup();
    updateOrderHooks.mutateAsync.mockRejectedValue(new Error("Boom"));
    const { setDetailPanelOpen } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByTestId("order-detail-footer")).getByRole("button", { name: "Save & close" }));

    await waitFor(() => expect(updateOrderHooks.mutateAsync).toHaveBeenCalled());
    expect(setDetailPanelOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("opens the close-order dialog from Close order without closing the sheet", async () => {
    const user = userEvent.setup();
    const { setDetailPanelOpen } = renderPanel();

    await user.click(within(await screen.findByTestId("order-detail-footer")).getByRole("button", { name: "Close order" }));

    expect(await screen.findByRole("dialog", { name: /Close order/i })).toBeInTheDocument();
    expect(setDetailPanelOpen).not.toHaveBeenCalled();
  });

  it("asks before discarding a dirty inline field when Close order is pressed", async () => {
    const user = userEvent.setup();
    unsavedConfirm.confirm.mockResolvedValueOnce(false);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit: Description" }));
    await user.type(await screen.findByRole("textbox", { name: "Description" }), " draft");
    await user.click(within(screen.getByTestId("order-detail-footer")).getByRole("button", { name: "Close order" }));

    expect(unsavedConfirm.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Noise draft");
    expect(screen.queryByRole("dialog", { name: /Close order/i })).not.toBeInTheDocument();
  });

  it("shows only Close window (no Save & close, no lifecycle close) for a closed order", async () => {
    const user = userEvent.setup();
    const { setDetailPanelOpen } = renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "closed", closedAt },
    });

    const footer = await screen.findByTestId("order-detail-footer");
    expect(within(footer).queryByRole("button", { name: "Save & close" })).not.toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Close order" })).not.toBeInTheDocument();
    await user.click(within(footer).getByRole("button", { name: "Close window" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("replaces Cancel order with Delete order in the footer after the order is cancelled", async () => {
    stubViewport(true);
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, status: "cancelled", closedAt },
    });

    const footer = await screen.findByTestId("order-detail-footer");
    expect(within(footer).getByRole("button", { name: "Delete order" })).toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
    expect(within(footer).queryByRole("button", { name: "Close order" })).not.toBeInTheDocument();
  });
});

describe("OrderDetailPanel items tab add search", () => {
  const closedAt = "2026-11-05T14:59:54.258807+00:00";

  it("shows the unified search above the tables and opens the material dialog from it", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    const actions = await screen.findByTestId("order-items-actions");
    expect(screen.queryByTestId("order-items-empty")).not.toBeInTheDocument();
    expect(within(actions).getByTestId("order-add-lines-search")).toBeInTheDocument();
    expect(within(actions).getByTestId("order-add-lines-allow-services")).toHaveTextContent("true");
    expect(within(actions).getByTestId("order-add-lines-allow-materials")).toHaveTextContent("true");

    await user.click(within(actions).getByTestId("order-add-lines-open-material"));
    expect(screen.getByTestId("add-material-dialog-stub")).toHaveTextContent("order-1:catalog");
  });

  it("keeps the search at the top of an empty editable items tab", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), { order: { ...order, services: [], materials: [] } });

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    const empty = await screen.findByTestId("order-items-empty");
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-items-actions")).toBeInTheDocument();
    expect(screen.getByTestId("order-add-lines-search")).toBeInTheDocument();
  });

  it("uses works-and-materials tab wording for industries that need it", async () => {
    const user = userEvent.setup();
    industryState.slug = "home_services";
    renderPanel();

    await user.click(await screen.findByRole("tab", { name: /Works & materials/i }));
    expect(await screen.findByTestId("order-add-lines-search")).toBeInTheDocument();
  });

  it("hides materials in the search without warehouse rights but keeps services", async () => {
    const user = userEvent.setup();
    roleState.role = "member";
    renderPanel();

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    const actions = await screen.findByTestId("order-items-actions");
    expect(within(actions).getByTestId("order-add-lines-allow-services")).toHaveTextContent("true");
    expect(within(actions).getByTestId("order-add-lines-allow-materials")).toHaveTextContent("false");
  });

  it("shows no search on a closed (content-locked) order", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), { order: { ...order, status: "closed", closedAt } });

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    expect(await screen.findByText("Oil change")).toBeInTheDocument();
    expect(screen.queryByTestId("order-items-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-add-lines-search")).not.toBeInTheDocument();
  });

  it("shows no search on a locked order with no lines either", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), { order: { ...order, services: [], materials: [], status: "closed", closedAt } });

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    const empty = await screen.findByTestId("order-items-empty");
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-add-lines-search")).not.toBeInTheDocument();
  });

  it("edits a service line price inline and saves through the narrow mutation", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    updateServiceLineMock.mockClear();
    renderPanel(onOrderUpdated);

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    await user.click(await screen.findByTestId("service-line-price-line-1"));
    const input = await screen.findByLabelText("Price");
    await user.clear(input);
    await user.type(input, "55");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(updateServiceLineMock).toHaveBeenCalledWith({
        orderId: "order-1",
        lineId: "line-1",
        patch: { price: 55 },
      });
    });
    expect(onOrderUpdated).toHaveBeenCalled();
  });

  it("keeps the sheet open when Esc cancels a service line price editor", async () => {
    const user = userEvent.setup();
    const setDetailPanelOpen = vi.fn();
    renderPanel(vi.fn(), setDetailPanelOpen);

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    await user.click(await screen.findByTestId("service-line-price-line-1"));
    expect(await screen.findByTestId("service-line-price-editor-line-1")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("service-line-price-editor-line-1")).not.toBeInTheDocument();
    });
    expect(setDetailPanelOpen).not.toHaveBeenCalledWith(false);
    expect(updateServiceLineMock).not.toHaveBeenCalled();
  });

  it("keeps service line prices read-only on a closed order", async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(), vi.fn(), { order: { ...order, status: "closed", closedAt } });

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    expect(await screen.findByText("Oil change")).toBeInTheDocument();
    expect(screen.queryByTestId("service-line-price-line-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit.*price/i })).not.toBeInTheDocument();
  });

  it("auto-opens the price editor after a service is added from search", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [selected, setSelected] = useState(order);
      return (
        <OrderDetailPanel
          selectedOrder={selected}
          detailPanelOpen
          setDetailPanelOpen={vi.fn()}
          onOrderUpdated={setSelected}
          onStatusChange={vi.fn()}
        />
      );
    }
    renderWithQuery(<Harness />);

    await user.click(await screen.findByRole("tab", { name: /Services & materials/i }));
    expect(addLinesSearchHandlers.onServiceAdded).toBeTruthy();

    act(() => {
      addLinesSearchHandlers.onServiceAdded?.(
        {
          ...order,
          services: [
            { id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 },
            { id: "line-new", serviceId: "svc-new", serviceName: "Alignment", price: 0, quantity: 1 },
          ],
        },
        { catalogServiceId: "svc-new" },
      );
    });

    expect(await screen.findByTestId("service-line-price-editor-line-new")).toBeInTheDocument();
  });
});
