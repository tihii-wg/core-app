import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";

const chainDialogSpy = vi.hoisted(() => vi.fn());

vi.mock("./OrderCancelChainDialog", () => ({
  OrderCancelChainDialog: (props: { open: boolean; order: Order | null }) => {
    chainDialogSpy(props);
    return props.open ? <div data-testid="shared-cancel-chain-dialog">OrderCancelChainDialog</div> : null;
  },
}));

vi.mock("./CloseOrderDialog", () => ({ CloseOrderDialog: () => null }));
vi.mock("./useCloseOrder", () => ({
  useCancelOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./useDeleteOrder", () => ({
  useDeleteOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("./useMoveOrderOnBoard", () => ({
  useMoveOrderOnBoard: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false }),
}));
vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (v: number) => String(v), currency: "MDL" }),
}));
vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));
vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => true,
}));
vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isEntitlementPending: false }),
  useGuardSubscriptionWrite: () => vi.fn(),
}));
vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [] }),
}));
vi.mock("../documents/useGetDocumentTemplates", () => ({
  useGetDocumentTemplates: () => ({ data: [] }),
}));
vi.mock("../documents/usePrintOrderDocument", () => ({
  usePrintOrderDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./useClosedOrderPermissions", () => ({
  useClosedOrderActionPermissions: () => ({
    canManageClosedContent: false,
    canCancelClosed: true,
    canDeleteClosed: true,
    role: "owner",
    grants: { cancelClosed: [], deleteClosed: [] },
    ownerCanManageClosedOrders: true,
    isOwnerByOwnerId: true,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("./closedOrderPermissions", async () => {
  const actual = await vi.importActual<typeof import("./closedOrderPermissions")>("./closedOrderPermissions");
  return {
    ...actual,
    canOfferCancelOrderAction: () => true,
    canOfferDeleteClosedOrderAction: () => true,
  };
});
vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow) };
    },
  };
});

import { OrderActionsMenu } from "./OrderActionsMenu";
import OrderDetailPanel from "./OrderDetailPanel";

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: [], isLoading: false, error: null }),
}));
vi.mock("./useUpdateOrder", () => ({
  useUpdateOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("./useGetOrders", () => ({
  useUpdateOrderTaxInvoiceNumber: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOrderStatus: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock("./useOrdersWarrantyIndicators", () => ({
  useOrdersWarrantyIndicators: () => ({ byOrderId: new Map(), isLoading: false }),
}));
vi.mock("./OrderWarrantyCoverageSection", () => ({ OrderWarrantyCoverageSection: () => null }));
vi.mock("./WarrantyOrderSection", () => ({ default: () => null }));
vi.mock("./OrderWarehouseActions", () => ({ default: () => null }));
vi.mock("./OrderAttachmentsSection", () => ({ default: () => null }));
vi.mock("./OrderFeedSection", () => ({ default: () => null }));
vi.mock("./useOrderFeed", () => ({
  useGetOrderComments: () => ({ comments: [], isUnavailable: false, isLoading: false, isError: false }),
  useGetOrderEvents: () => ({ events: [], isUnavailable: false, isLoading: false, isError: false }),
  useCreateOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../finance/PaymentHistorySection", () => ({ PaymentHistorySection: () => null }));
vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL", requireTaxInvoiceNumber: false } }),
}));
vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

const order: Order = {
  id: "order-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 10,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "",
  updatedAt: "",
};

describe("shared OrderCancelChainDialog wiring", () => {
  it("OrderActionsMenu mounts OrderCancelChainDialog", () => {
    chainDialogSpy.mockClear();
    renderWithQuery(
      <OrderActionsMenu
        order={order}
        onView={vi.fn()}
        onEdit={vi.fn()}
        onStatusChange={vi.fn()}
        onCreateInvoice={vi.fn()}
        requireTaxInvoiceNumber={false}
      />,
    );
    expect(chainDialogSpy).toHaveBeenCalled();
    expect(chainDialogSpy.mock.calls.some((call) => call[0]?.order?.id === "order-1")).toBe(true);
  });

  it("OrderDetailPanel mounts OrderCancelChainDialog", () => {
    chainDialogSpy.mockClear();
    renderWithQuery(
      <OrderDetailPanel
        selectedOrder={order}
        detailPanelOpen
        setDetailPanelOpen={vi.fn()}
        onOrderUpdated={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );
    expect(chainDialogSpy).toHaveBeenCalled();
    expect(chainDialogSpy.mock.calls.some((call) => call[0]?.order?.id === "order-1")).toBe(true);
  });
});
