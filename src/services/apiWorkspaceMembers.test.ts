import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };
type Request = { table: string; calls: Call[] };
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({
  requests: [] as Request[],
  tableResults: {} as Record<string, Result[]>,
  rpcResults: {} as Record<string, Result>,
  rpcCalls: [] as { name: string; args: unknown }[],
}));

vi.mock("./supabase", () => {
  function builder(table: string) {
    const request: Request = { table, calls: [] };
    state.requests.push(request);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "is", "in", "limit", "maybeSingle", "single"]) {
      chain[method] = (...args: unknown[]) => {
        request.calls.push({ method, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: Result) => unknown) => resolve(state.tableResults[table]?.shift() ?? { data: null, error: null });
    return chain;
  }

  return {
    default: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "owner@example.com" } } }) },
      from: (table: string) => builder(table),
      rpc: async (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return state.rpcResults[name] ?? { data: null, error: null };
      },
    },
  };
});

import { addWorkspaceMember, assignableTeamRole, deleteWorkspace, getWorkspaceMembers, removeWorkspaceMember, updateWorkspaceMemberRole } from "./apiWorkspaces";

const membership: Result = { data: { role: "owner" }, error: null };

function requestsFor(table: string) {
  return state.requests.filter((request) => request.table === table);
}

describe("team member service", () => {
  beforeEach(() => {
    state.requests = [];
    state.tableResults = {};
    state.rpcResults = {};
    state.rpcCalls = [];
  });

  it("loads active members of the workspace with their profiles in one call", async () => {
    state.tableResults.workspace_members = [
      membership,
      {
        data: [
          { user_id: "user-2", role: "member", created_at: "2026-02-01" },
          { user_id: "user-1", role: "owner", created_at: "2026-01-01" },
        ],
        error: null,
      },
    ];
    state.rpcResults.workspace_member_profiles = { data: [{ user_id: "user-2", full_name: "Grace Hopper", email: "grace@example.com" }], error: null };

    const members = await getWorkspaceMembers("ws-1");

    expect(members.map((member) => [member.userId, member.role, member.fullName, member.email])).toEqual([
      ["user-1", "owner", null, "owner@example.com"],
      ["user-2", "member", "Grace Hopper", "grace@example.com"],
    ]);
    const list = requestsFor("workspace_members")[1].calls;
    expect(list).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
    expect(list).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(state.rpcCalls).toEqual([{ name: "workspace_member_profiles", args: { target_workspace: "ws-1" } }]);
  });

  it("refuses a workspace the user does not belong to", async () => {
    state.tableResults.workspace_members = [{ data: null, error: null }];

    await expect(getWorkspaceMembers("ws-other")).rejects.toThrow("You do not have access to this workspace");
  });

  it("never assigns the owner role", () => {
    expect(() => assignableTeamRole("owner")).toThrow("Choose admin, manager, or member");
    expect(assignableTeamRole(" Manager ")).toBe("manager");
  });

  it("adds an existing account to workspace_members only", async () => {
    state.rpcResults.workspace_member_find_user = { data: "user-9", error: null };
    state.tableResults.workspace_members = [membership, { data: [], error: null }, { data: null, error: null }];

    await addWorkspaceMember("ws-1", { email: " New@Example.com ", role: "admin" });

    expect(state.rpcCalls).toContainEqual({ name: "workspace_member_find_user", args: { target_workspace: "ws-1", member_email: "new@example.com" } });
    const insert = requestsFor("workspace_members")[2].calls.find((call) => call.method === "insert");
    expect(insert?.args[0]).toEqual([{ workspace_id: "ws-1", user_id: "user-9", role: "admin" }]);
    expect(requestsFor("employees")).toHaveLength(0);
  });

  it("restores a previously removed member instead of inserting a duplicate", async () => {
    state.rpcResults.workspace_member_find_user = { data: "user-9", error: null };
    state.tableResults.workspace_members = [membership, { data: [{ user_id: "user-9", role: "member", deleted_at: "2026-01-01" }], error: null }, { data: [{ user_id: "user-9" }], error: null }];

    await addWorkspaceMember("ws-1", { email: "old@example.com", role: "manager" });

    const update = requestsFor("workspace_members")[2].calls.find((call) => call.method === "update");
    expect(update?.args[0]).toEqual({ role: "manager", deleted_at: null });
  });

  it("explains when the email has no account or is already a member", async () => {
    state.rpcResults.workspace_member_find_user = { data: null, error: null };
    state.tableResults.workspace_members = [membership];
    await expect(addWorkspaceMember("ws-1", { email: "nobody@example.com", role: "member" })).rejects.toThrow("No Core App account uses this email");

    state.rpcResults.workspace_member_find_user = { data: "user-9", error: null };
    state.tableResults.workspace_members = [membership, { data: [{ user_id: "user-9", role: "member", deleted_at: null }], error: null }];
    await expect(addWorkspaceMember("ws-1", { email: "dup@example.com", role: "member" })).rejects.toThrow("already a team member");
  });

  it("reports a permission error when RLS blocks the lookup", async () => {
    state.rpcResults.workspace_member_find_user = { data: null, error: { code: "42501", message: "You do not have permission to add team members" } };
    state.tableResults.workspace_members = [membership];

    await expect(addWorkspaceMember("ws-1", { email: "a@example.com", role: "member" })).rejects.toThrow("You do not have permission to add team members");
  });

  function queueDeleteChecks(activeWorkspaceId: string) {
    state.tableResults.workspace_members = [{ data: [{ workspace_id: "ws-1" }, { workspace_id: "ws-2" }], error: null }];
    state.tableResults.profiles = [{ data: { active_workspace_id: activeWorkspaceId }, error: null }];
  }

  it("deletes a workspace through the owner-only database function", async () => {
    queueDeleteChecks("ws-2");

    const result = await deleteWorkspace("ws-1");

    expect(state.rpcCalls).toEqual([{ name: "soft_delete_workspace", args: { target_workspace: "ws-1" } }]);
    expect(state.requests.some((request) => request.calls.some((call) => call.method === "update"))).toBe(false);
    expect(result.nextWorkspaceId).toBe("ws-2");
  });

  it("switches the active workspace only after the database function succeeds", async () => {
    queueDeleteChecks("ws-1");

    const result = await deleteWorkspace("ws-1");

    const profileUpdate = requestsFor("profiles").at(-1)?.calls;
    expect(profileUpdate).toContainEqual({ method: "update", args: [{ active_workspace_id: "ws-2" }] });
    expect(result.nextWorkspaceId).toBe("ws-2");
  });

  it("never falls back to direct table writes when the database function is unavailable or denied", async () => {
    queueDeleteChecks("ws-1");
    state.rpcResults.soft_delete_workspace = { data: null, error: { code: "PGRST202", message: "function not found" } };

    await expect(deleteWorkspace("ws-1")).rejects.toThrow("public.soft_delete_workspace");

    queueDeleteChecks("ws-1");
    state.rpcResults.soft_delete_workspace = { data: null, error: { code: "42501", message: "Only the workspace owner can delete it" } };

    await expect(deleteWorkspace("ws-1")).rejects.toThrow("Only the workspace owner can delete it");
    expect(state.requests.some((request) => request.calls.some((call) => call.method === "update" || call.method === "delete"))).toBe(false);
  });

  it("refuses to delete the last workspace", async () => {
    state.tableResults.workspace_members = [{ data: [{ workspace_id: "ws-1" }], error: null }];

    await expect(deleteWorkspace("ws-1")).rejects.toThrow("You cannot delete last workspace");
    expect(state.rpcCalls).toEqual([]);
  });

  it("scopes role changes and removals to the workspace and reports RLS denials", async () => {
    state.tableResults.workspace_members = [{ data: [{ user_id: "user-2", role: "manager" }], error: null }];
    await updateWorkspaceMemberRole("ws-1", "user-2", "manager");
    const roleCalls = requestsFor("workspace_members")[0].calls;
    expect(roleCalls).toContainEqual({ method: "update", args: [{ role: "manager" }] });
    expect(roleCalls).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
    expect(roleCalls).toContainEqual({ method: "eq", args: ["user_id", "user-2"] });

    state.tableResults.workspace_members = [{ data: [], error: null }];
    await expect(removeWorkspaceMember("ws-1", "owner-1")).rejects.toThrow("You do not have permission to remove this member");
    await expect(updateWorkspaceMemberRole("ws-1", "user-2", "owner")).rejects.toThrow("Choose admin, manager, or member");
  });
});
