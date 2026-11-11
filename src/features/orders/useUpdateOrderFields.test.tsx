import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderFields = vi.hoisted(() => vi.fn());
const upsertCustomFieldValues = vi.hoisted(() => vi.fn());
const guardWrite = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn() }));

vi.mock("../../services/apiOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiOrders")>();
  return { ...actual, updateOrderFields };
});

vi.mock("../../services/apiCustomFields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiCustomFields")>();
  return { ...actual, upsertCustomFieldValues };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => guardWrite,
}));

vi.mock("react-hot-toast", () => ({ default: toastMock }));

import { useUpdateOrderCustomFieldValue, useUpdateOrderFields } from "./useUpdateOrderFields";

describe("useUpdateOrderFields", () => {
  let client: QueryClient;

  beforeEach(() => {
    updateOrderFields.mockReset();
    upsertCustomFieldValues.mockReset();
    guardWrite.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("guards the write, saves the patch, toasts success and invalidates every order surface", async () => {
    updateOrderFields.mockResolvedValue({ id: "order-1" });
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOrderFields(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "order-1", patch: { description: "Hi" } });
    });

    expect(guardWrite).toHaveBeenCalledTimes(1);
    expect(updateOrderFields).toHaveBeenCalledWith("order-1", { description: "Hi" }, "ws-1");
    expect(toastMock.success).toHaveBeenCalledWith("Saved", expect.any(Object));
    for (const queryKey of [
      ["orders", "ws-1"],
      ["orders", "ws-1", "awaitingPayment"],
      ["orders-page", "ws-1"],
      ["order", "order-1"],
      ["dashboard", "ws-1"],
      ["order_events", "ws-1"],
      ["orders-warranty-indicators", "ws-1"],
      ["warranty-records", "ws-1"],
      ["custom-field-values", "ws-1", "order-1"],
      ["custom-field-values-batch", "ws-1"],
    ]) {
      expect(spy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("rejects without a toast so the inline editor can show the error", async () => {
    updateOrderFields.mockRejectedValue(new Error("Order is closed"));

    const { result } = renderHook(() => useUpdateOrderFields(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ orderId: "order-1", patch: { description: "Hi" } })).rejects.toThrow(
        "Order is closed",
      );
    });

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("does not call the API when the subscription guard throws", async () => {
    guardWrite.mockImplementation(() => {
      throw new Error("Subscription expired");
    });

    const { result } = renderHook(() => useUpdateOrderFields(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ orderId: "order-1", patch: { description: "Hi" } })).rejects.toThrow(
        "Subscription expired",
      );
    });

    expect(updateOrderFields).not.toHaveBeenCalled();
  });
});

describe("useUpdateOrderCustomFieldValue", () => {
  it("upserts one definition and refreshes custom-field queries", async () => {
    guardWrite.mockReset();
    upsertCustomFieldValues.mockReset();
    upsertCustomFieldValues.mockResolvedValue(undefined);
    toastMock.success.mockReset();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOrderCustomFieldValue(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "order-1", definitionId: "def-1", value: "x" });
    });

    expect(upsertCustomFieldValues).toHaveBeenCalledWith("ws-1", "order-1", [{ definitionId: "def-1", value: "x" }]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["custom-field-values", "ws-1", "order-1"] });
    expect(toastMock.success).toHaveBeenCalledWith("Saved", expect.any(Object));
  });
});
