import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderHookWithQuery } from "../../tests/renderQuery";
import { shouldOfferPostPaymentStatusStep, useOrderStatusChange } from "./useOrderStatusChange";

const moveOnBoard = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const updateStatus = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const paymentsState = vi.hoisted(() => ({
  payments: [] as Array<{
    id: string;
    orderId: string | null;
    amount: number;
    kind: "payment" | "refund" | "void";
    status: string;
  }>,
  isLoading: false,
}));

const definitionsState = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
}));

const workspaceState = vi.hoisted(() => ({
  requireTaxInvoiceNumber: false,
}));

const roleState = vi.hoisted(() => ({ role: "owner" as string, isOwner: true, canWrite: true }));

vi.mock("./useMoveOrderOnBoard", () => ({
  useMoveOrderOnBoard: () => moveOnBoard,
}));

vi.mock("./useGetOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useGetOrders")>();
  return {
    ...actual,
    useUpdateOrderStatus: () => updateStatus,
  };
});

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({
    payments: paymentsState.payments,
    isLoading: paymentsState.isLoading,
    isFetching: false,
    error: null,
    isUnavailable: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: definitionsState.data, isLoading: false }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { requireTaxInvoiceNumber: workspaceState.requireTaxInvoiceNumber, currency: "MDL" },
    isLoading: false,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => roleState.role,
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => roleState.isOwner,
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: roleState.canWrite, isEntitlementPending: false }),
  useGuardSubscriptionWrite: () => vi.fn(),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => `${n} MDL`, currency: "MDL" }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

const order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada",
  clientEmail: "",
  clientPhone: "",
  orderNumber: "ORD-1",
  vehicleId: "",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "new",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 1000,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  closedAt: null,
  customStatusId: null,
  customStatus: null,
  clientType: "individual",
  taxInvoiceNumber: "",
} as Order;

describe("useOrderStatusChange", () => {
  beforeEach(() => {
    moveOnBoard.mutateAsync.mockReset();
    updateStatus.mutateAsync.mockReset();
    paymentsState.payments = [];
    paymentsState.isLoading = false;
    definitionsState.data = [];
    workspaceState.requireTaxInvoiceNumber = false;
    roleState.role = "owner";
    roleState.isOwner = true;
    roleState.canWrite = true;
  });

  it("exposes system status options and marks paid-locked for non-owners", async () => {
    roleState.role = "admin";
    roleState.isOwner = false;
    const { result } = renderHookWithQuery(() =>
      useOrderStatusChange({ ...order, status: "paid", isPaid: true, paymentStatus: "paid" }),
    );

    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.paidStatusLocked).toBe(true);
    expect(result.current.canChangeStatus).toBe(false);
    expect(result.current.options.every((option) => option.disabled)).toBe(true);
    expect(result.current.options[0]?.disabledReason).toMatch(/workspace owner/i);
  });

  it("disables paid option when tax invoice is required for a legal entity", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    const { result } = renderHookWithQuery(() =>
      useOrderStatusChange({
        ...order,
        status: "completed",
        clientType: "organization",
        taxInvoiceNumber: "",
      }),
    );

    await waitFor(() => expect(result.current.options.some((o) => o.systemStatus === "paid")).toBe(true));
    const paid = result.current.options.find((o) => o.systemStatus === "paid");
    expect(paid?.disabled).toBe(true);
    expect(paid?.disabledReason).toBeTruthy();
  });

  it("disables a custom status when min-paid is not met, then unlocks after payment", async () => {
    definitionsState.data = [
      {
        id: "d-new",
        workspaceId: "ws-1",
        entity: "order",
        name: "New",
        color: null,
        systemStatus: "new",
        statusGroup: "open",
        code: "new",
        semanticAction: "normal",
        isActive: true,
        isDefault: true,
        sortOrder: 1,
        minPaidPercent: null,
      },
      {
        id: "d-progress",
        workspaceId: "ws-1",
        entity: "order",
        name: "In production",
        color: "#00aa00",
        systemStatus: "in-progress",
        statusGroup: "open",
        code: "in_progress",
        semanticAction: "normal",
        isActive: true,
        isDefault: false,
        sortOrder: 2,
        minPaidPercent: 50,
      },
    ];

    const { result, rerender } = renderHookWithQuery(
      ({ netPaid }: { netPaid: number | null }) =>
        useOrderStatusChange(
          { ...order, customStatusId: "d-new", status: "new" },
          { netPaidOverride: netPaid },
        ),
      { initialProps: { netPaid: 0 } },
    );

    await waitFor(() => expect(result.current.options.some((o) => o.id === "d-progress")).toBe(true));
    const blocked = result.current.options.find((o) => o.id === "d-progress");
    expect(blocked?.disabled).toBe(true);
    expect(blocked?.disabledReason).toMatch(/50%/);

    rerender({ netPaid: 500 });
    await waitFor(() => {
      const unlocked = result.current.options.find((o) => o.id === "d-progress");
      expect(unlocked?.disabled).toBe(false);
    });
  });

  it("changeTo calls legacy callback for system statuses", async () => {
    const onLegacyStatusChange = vi.fn();
    const { result } = renderHookWithQuery(() =>
      useOrderStatusChange(order, { onLegacyStatusChange }),
    );

    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    const target = result.current.options.find((o) => o.systemStatus === "in-progress");
    expect(target).toBeTruthy();

    let changeResult: Awaited<ReturnType<typeof result.current.changeTo>> | undefined;
    await act(async () => {
      changeResult = await result.current.changeTo(target!.id);
    });

    expect(onLegacyStatusChange).toHaveBeenCalledExactlyOnceWith("in-progress");
    // No optimistic order: the owner applies the status only after the server confirms it.
    expect(changeResult).toEqual({ ok: true });
    expect(moveOnBoard.mutateAsync).not.toHaveBeenCalled();
  });

  it("changeTo returns the disabled reason without calling the server", async () => {
    roleState.role = "admin";
    roleState.isOwner = false;
    const onLegacyStatusChange = vi.fn();
    const { result } = renderHookWithQuery(() =>
      useOrderStatusChange(
        { ...order, status: "paid", isPaid: true, paymentStatus: "paid" },
        { onLegacyStatusChange },
      ),
    );

    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    const target = result.current.options.find((o) => o.systemStatus === "in-progress");
    const changeResult = await result.current.changeTo(target!.id);
    expect(changeResult.ok).toBe(false);
    if (!changeResult.ok) expect(changeResult.reason).toMatch(/workspace owner/i);
    expect(onLegacyStatusChange).not.toHaveBeenCalled();
  });
});

describe("shouldOfferPostPaymentStatusStep", () => {
  it("offers the step only for open writable orders", () => {
    expect(shouldOfferPostPaymentStatusStep(order, true)).toBe(true);
    expect(shouldOfferPostPaymentStatusStep(order, false)).toBe(false);
    expect(shouldOfferPostPaymentStatusStep({ ...order, status: "cancelled" }, true)).toBe(false);
    expect(
      shouldOfferPostPaymentStatusStep({ ...order, status: "closed", closedAt: "2026-01-02T00:00:00.000Z" }, true),
    ).toBe(false);
  });
});
