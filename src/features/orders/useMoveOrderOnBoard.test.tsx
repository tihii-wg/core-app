import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";

const moveOrderOnBoard = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrderBoard", () => ({
  moveOrderOnBoard,
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";

const baseOrder: Order = {
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
  status: "new",
  customStatusId: null,
  customStatus: null,
  closedAt: null,
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 10,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "",
  updatedAt: "",
};

describe("useMoveOrderOnBoard optimistic status", () => {
  let client: QueryClient;

  beforeEach(() => {
    moveOrderOnBoard.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(["orders", "ws-1"], [baseOrder]);
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("shows the new status in the list cache before the mutation resolves", async () => {
    let resolveMove!: (value: unknown) => void;
    moveOrderOnBoard.mockReturnValue(
      new Promise((resolve) => {
        resolveMove = resolve;
      }),
    );

    const { result } = renderHook(() => useMoveOrderOnBoard(), { wrapper });

    act(() => {
      result.current.mutate({
        orderId: "order-1",
        status: "in-progress",
        customStatusId: null,
        currentStatus: "new",
      });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Order[]>(["orders", "ws-1"]);
      expect(cached?.[0]?.status).toBe("in-progress");
    });

    await act(async () => {
      resolveMove({
        status: "in-progress",
        customStatusId: null,
        customStatus: null,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the list cache when the mutation fails", async () => {
    moveOrderOnBoard.mockRejectedValue(new Error("status locked"));

    const { result } = renderHook(() => useMoveOrderOnBoard(), { wrapper });

    await act(async () => {
      result.current.mutate({
        orderId: "order-1",
        status: "in-progress",
        customStatusId: null,
        currentStatus: "new",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Order[]>(["orders", "ws-1"]);
    expect(cached?.[0]?.status).toBe("new");
  });
});
