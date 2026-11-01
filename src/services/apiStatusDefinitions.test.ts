import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCustomStatusTransition, getStatusTransitions, isCustomStatusTransitionAllowed } from "./apiStatusDefinitions";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

type Result = { data: Record<string, unknown>[] | null; error: { message?: string; code?: string } | null };

function query(result: Result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain;
}

const transitions = new Map<string, Set<string>>([["a", new Set(["b", "c"])]]);

describe("isCustomStatusTransitionAllowed", () => {
  it("allows when there is no source custom status", () => {
    expect(isCustomStatusTransitionAllowed(transitions, null, "a")).toBe(true);
    expect(isCustomStatusTransitionAllowed(transitions, null, null)).toBe(true);
  });

  it("allows unchanged status", () => {
    expect(isCustomStatusTransitionAllowed(transitions, "a", "a")).toBe(true);
  });

  it("allows when the source has no configured transitions", () => {
    expect(isCustomStatusTransitionAllowed(new Map(), "a", "z")).toBe(true);
    expect(isCustomStatusTransitionAllowed(transitions, "x", "z")).toBe(true);
    expect(isCustomStatusTransitionAllowed(transitions, "x", null)).toBe(true);
  });

  it("allows only listed next statuses", () => {
    expect(isCustomStatusTransitionAllowed(transitions, "a", "b")).toBe(true);
    expect(isCustomStatusTransitionAllowed(transitions, "a", "z")).toBe(false);
  });

  it("forbids custom -> system-only column when the source has transitions", () => {
    expect(isCustomStatusTransitionAllowed(transitions, "a", null)).toBe(false);
  });
});

describe("status transitions api", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("groups rows by source status", async () => {
    from.mockReturnValue(
      query({
        data: [
          { status_id: "a", next_status_id: "b" },
          { status_id: "a", next_status_id: "c" },
          { status_id: "b", next_status_id: "a" },
        ],
        error: null,
      }),
    );
    const map = await getStatusTransitions("ws-1");
    expect(from).toHaveBeenCalledWith("status_transitions");
    expect([...(map.get("a") ?? [])]).toEqual(["b", "c"]);
    expect([...(map.get("b") ?? [])]).toEqual(["a"]);
  });

  it("returns an empty map when the table is missing", async () => {
    from.mockReturnValue(query({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.status_transitions' in the schema cache" } }));
    expect((await getStatusTransitions("ws-1")).size).toBe(0);
  });

  it("assert degrades to allowed when the table is missing", async () => {
    from.mockReturnValue(query({ data: null, error: { code: "42P01", message: "relation does not exist" } }));
    await expect(assertCustomStatusTransition("ws-1", "a", "z")).resolves.toBeUndefined();
  });

  it("assert throws for a forbidden transition and allows a configured one", async () => {
    from.mockReturnValue(query({ data: [{ status_id: "a", next_status_id: "b" }], error: null }));
    await expect(assertCustomStatusTransition("ws-1", "a", "z")).rejects.toThrow();
    await expect(assertCustomStatusTransition("ws-1", "a", null)).rejects.toThrow();
    await expect(assertCustomStatusTransition("ws-1", "a", "b")).resolves.toBeUndefined();
  });

  it("assert skips the query when there is no source custom status", async () => {
    await expect(assertCustomStatusTransition("ws-1", null, "b")).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});
