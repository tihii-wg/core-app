import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; method: string; args: unknown[] };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  results: {} as Record<string, unknown>,
}));

vi.mock("./supabase", () => {
  function builder(table: string) {
    const key = () => {
      const methods = state.calls.filter((call) => call.table === table).map((call) => call.method);
      return methods.includes("maybeSingle") ? `${table}:single` : table;
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "maybeSingle"]) {
      chain[method] = (...args: unknown[]) => {
        state.calls.push({ table, method, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) => resolve(state.results[key()]);
    return chain;
  }

  return {
    default: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "owner@example.com" } } }) },
      from: (table: string) => {
        state.calls = state.calls.filter((call) => call.table !== table);
        return builder(table);
      },
    },
  };
});

import { getWorkspaceMembers } from "./apiWorkspaces";

describe("getWorkspaceMembers", () => {
  beforeEach(() => {
    state.calls = [];
    state.results = {};
  });

  it("loads active members of the workspace with their profile details", async () => {
    state.results["workspace_members:single"] = { data: { role: "owner" }, error: null };
    state.results.workspace_members = { data: [{ user_id: "user-1", role: "owner" }, { user_id: "user-2", role: "member" }], error: null };
    state.results.profiles = { data: [{ id: "user-2", full_name: "Grace Hopper", email: "grace@example.com" }], error: null };

    const members = await getWorkspaceMembers("ws-1");
    const membersCalls = state.calls;

    expect(members).toEqual([
      { userId: "user-1", role: "owner", fullName: null, email: "owner@example.com", isCurrentUser: true },
      { userId: "user-2", role: "member", fullName: "Grace Hopper", email: "grace@example.com", isCurrentUser: false },
    ]);
    const memberFilters = membersCalls.filter((call) => call.table === "workspace_members");
    expect(memberFilters).toContainEqual({ table: "workspace_members", method: "eq", args: ["workspace_id", "ws-1"] });
    expect(memberFilters).toContainEqual({ table: "workspace_members", method: "is", args: ["deleted_at", null] });
    expect(membersCalls).toContainEqual({ table: "profiles", method: "in", args: ["id", ["user-1", "user-2"]] });
  });

  it("refuses a workspace the user does not belong to", async () => {
    state.results["workspace_members:single"] = { data: null, error: null };

    await expect(getWorkspaceMembers("ws-other")).rejects.toThrow("You do not have access to this workspace");
  });
});
