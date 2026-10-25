import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee, Order } from "../../lib/types";
import OrderDetailPanel from "./OrderDetailPanel";

const updateOrderHooks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

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

vi.mock("./useGetOrders", () => ({
  useUpdateOrderTaxInvoiceNumber: () => ({
    mutateAsync: taxInvoiceHooks.mutateAsync,
    isPending: taxInvoiceHooks.isPending,
  }),
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
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({
    services: [{ id: "svc-tires", service_name: "Tires", service_price: 80, status: "active" }],
  }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees, error: null, isLoading: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("./OrderAttachmentsSection", () => ({
  default: () => <div data-testid="order-attachments-stub" />,
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const industryState = vi.hoisted(() => ({ slug: "auto_repair" as string }));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(industryState.slug);
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: industryState.slug, industryId: null, isLoading: false, error: null };
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
  industryState.slug = "auto_repair";
  updateOrderHooks.isPending = false;
  updateOrderHooks.mutateAsync.mockReset();
  taxInvoiceHooks.isPending = false;
  taxInvoiceHooks.mutateAsync.mockReset();
  workspaceState.requireTaxInvoiceNumber = false;
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

  it("saves order edits and closes the details window", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const setDetailPanelOpen = vi.fn();
    updateOrderHooks.mutateAsync.mockResolvedValue({ ...order, device: "Audi" });

    renderPanel(onOrderUpdated, setDetailPanelOpen);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const deviceInput = screen.getByLabelText("Vehicle *");
    await user.clear(deviceInput);
    await user.type(deviceInput, "Audi");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        device: "Audi",
        carNumber: "ABC123",
        description: "Noise",
        assignedEmployeeId: "emp-1",
        vin: "1HGBH41JXMN109186",
      }),
    );
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ device: "Audi" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("saves an edited VIN and an added service", async () => {
    const user = userEvent.setup();
    updateOrderHooks.mutateAsync.mockResolvedValue({ ...order, vin: "2HGBH41JXMN109187" });

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const vinInput = screen.getByLabelText("VIN *");
    await user.clear(vinInput);
    await user.type(vinInput, "2HGBH41JXMN109187");
    await user.click(screen.getByPlaceholderText("Service"));
    await user.click(screen.getByRole("button", { name: /Tires/i }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateOrderHooks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        vin: "2HGBH41JXMN109187",
        services: [
          { id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 },
          expect.objectContaining({ serviceId: "svc-tires", serviceName: "Tires", price: 80 }),
        ],
      }),
    );
  });

  it("preserves historical VIN and plate when editing under home_services", async () => {
    industryState.slug = "home_services";
    const user = userEvent.setup();
    updateOrderHooks.mutateAsync.mockResolvedValue(order);

    renderPanel();

    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();

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
    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute("href", "mailto:ada@example.com");
    expect(screen.getByRole("columnheader", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("Oil filter")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("MDL 70.00")).toBeInTheDocument();
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

  it("hides empty optional fields instead of placeholder dashes", async () => {
    const sparse: Order = {
      ...order,
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

  it("does not show the tax invoice field for individual customers", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    renderPanel(vi.fn(), vi.fn(), {
      order: { ...order, clientType: "individual", taxInvoiceNumber: "FV-HIDDEN" },
    });

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Tax invoice number")).not.toBeInTheDocument();
  });
});
