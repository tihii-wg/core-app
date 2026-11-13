import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useRemoteOrderEditNotice } from "./useRemoteOrderEditNotice";

const realtimeState = { ordersTouchAt: 0 };

vi.mock("./WorkspaceRealtimeProvider", () => ({
  useWorkspaceRealtime: () => realtimeState,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe("useRemoteOrderEditNotice", () => {
  it("shows notice only when dirty and ordersTouchAt advances", () => {
    realtimeState.ordersTouchAt = 10;
    const { result, rerender } = renderHook(
      ({ dirty }) => useRemoteOrderEditNotice("order-1", dirty),
      { wrapper, initialProps: { dirty: false } },
    );

    expect(result.current.showNotice).toBe(false);

    act(() => {
      realtimeState.ordersTouchAt = 20;
    });
    rerender({ dirty: false });
    expect(result.current.showNotice).toBe(false);

    rerender({ dirty: true });
    expect(result.current.showNotice).toBe(false);

    act(() => {
      realtimeState.ordersTouchAt = 30;
    });
    rerender({ dirty: true });
    expect(result.current.showNotice).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.showNotice).toBe(false);
  });

  it("resets notice when order id changes", () => {
    realtimeState.ordersTouchAt = 100;
    const { result, rerender } = renderHook(
      ({ orderId, dirty }) => useRemoteOrderEditNotice(orderId, dirty),
      { wrapper, initialProps: { orderId: "a", dirty: true } },
    );

    act(() => {
      realtimeState.ordersTouchAt = 200;
    });
    rerender({ orderId: "a", dirty: true });
    expect(result.current.showNotice).toBe(true);

    rerender({ orderId: "b", dirty: true });
    expect(result.current.showNotice).toBe(false);
  });
});
