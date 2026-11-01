import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStatusEventInputs,
  getOrderEvents,
  isMissingOrderEventRpc,
  recordOrderEvent,
  recordStatusChangeEvents,
  resetOrderEventRpcState,
  sortOrderEvents,
  toOrderEvent,
} from "./apiOrderEvents";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({ default: { from, rpc } }));

type Result = { data: Record<string, unknown>[] | null; error: { message?: string; code?: string } | null };

function query(result: Result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain;
}

describe("apiOrderEvents", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    resetOrderEventRpcState();
  });

  it("maps rows defensively and sorts newest first", () => {
    const a = toOrderEvent({ id: "a", order_id: "o", event_type: "status_changed", field_name: "status", old_value: "new", new_value: "paid", payload: [], actor_name: " ", created_at: "2026-11-01T10:00:00Z" });
    expect(a).toMatchObject({ actorName: null, payload: {}, oldValue: "new", newValue: "paid" });
    const b = toOrderEvent({ id: "b", created_at: "2026-11-01T11:00:00Z", payload: { old_name: "X" } });
    expect(sortOrderEvents([a, b]).map((event) => event.id)).toEqual(["b", "a"]);
  });

  it("reads events and reports a missing table as unavailable", async () => {
    from.mockReturnValueOnce(query({ data: [{ id: "1", order_id: "o", event_type: "status_changed", created_at: "2026-11-01T10:00:00Z" }], error: null }));
    expect((await getOrderEvents("ws", "o")).events).toHaveLength(1);

    from.mockReturnValueOnce(query({ data: null, error: { code: "PGRST205", message: "no table" } }));
    expect(await getOrderEvents("ws", "o")).toEqual({ events: [], isUnavailable: true });

    from.mockReturnValueOnce(query({ data: null, error: { code: "XX000", message: "boom" } }));
    await expect(getOrderEvents("ws", "o")).rejects.toThrow("boom");
  });

  it("builds one event per changed field", () => {
    expect(buildStatusEventInputs({ orderId: "o", source: "app", from: "new", to: "in-progress" })).toEqual([
      { orderId: "o", eventType: "status_changed", fieldName: "status", oldValue: "new", newValue: "in-progress", payload: { source: "app" } },
    ]);

    const both = buildStatusEventInputs({
      orderId: "o",
      source: "board",
      from: "new",
      to: "new",
      fromCustomStatusId: null,
      toCustomStatusId: "d1",
      toCustomStatusName: "QA",
    });
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ fieldName: "custom_status_id", oldValue: null, newValue: "d1", payload: { source: "board", new_name: "QA" } });

    expect(buildStatusEventInputs({ orderId: "o", source: "app", from: "new", to: "new" })).toEqual([]);
  });

  it("calls the RPC with prefixed params", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await recordOrderEvent({ orderId: "o", eventType: "status_changed", fieldName: "status", oldValue: "a", newValue: "b" })).toEqual({ recorded: true });
    expect(rpc).toHaveBeenCalledWith("crm_record_order_event", {
      p_order_id: "o",
      p_event_type: "status_changed",
      p_field_name: "status",
      p_old_value: "a",
      p_new_value: "b",
      p_payload: {},
    });
  });

  it("degrades without throwing when the RPC is missing, and stops retrying", async () => {
    expect(isMissingOrderEventRpc({ code: "PGRST202" })).toBe(true);
    expect(isMissingOrderEventRpc({ message: "Could not find the function public.crm_record_order_event" })).toBe(true);
    expect(isMissingOrderEventRpc({ code: "42501" })).toBe(false);

    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "missing" } });
    expect(await recordOrderEvent({ orderId: "o", eventType: "status_changed" })).toEqual({ recorded: false, reason: "rpc-missing" });
    await recordStatusChangeEvents({ orderId: "o", source: "app", from: "a", to: "b" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps denial and thrown failures to recorded:false", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "denied" } });
    expect(await recordOrderEvent({ orderId: "o", eventType: "x" })).toEqual({ recorded: false, reason: "denied" });
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await recordOrderEvent({ orderId: "o", eventType: "x" })).toEqual({ recorded: false, reason: "error" });
    expect(await recordOrderEvent({ orderId: " ", eventType: "x" })).toEqual({ recorded: false, reason: "error" });
  });
});
