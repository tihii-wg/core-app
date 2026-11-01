import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildActivityRow, getActivityLog, recordActivity, resolveActorName, toActivityLogEntry } from "./apiActivityLog";

const from = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from, auth: { getUser } },
}));

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

describe("apiActivityLog", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("maps rows and tolerates missing optional fields", () => {
    expect(toActivityLogEntry({ id: "1", created_at: "2026-10-31T10:00:00Z", actor_name: " ", entity_type: "order", entity_id: null, event: "status_changed" })).toEqual({
      id: "1",
      createdAt: "2026-10-31T10:00:00Z",
      actorName: null,
      entityType: "order",
      entityId: null,
      event: "status_changed",
    });
  });

  it("returns entries from activity_log", async () => {
    from.mockReturnValue(query({ data: [{ id: "a", created_at: "2026-10-31T10:00:00Z", actor_name: "Ana", entity_type: "order", entity_id: "o1", event: "created" }], error: null }));
    const result = await getActivityLog("ws-1");
    expect(from).toHaveBeenCalledWith("activity_log");
    expect(result.isUnavailable).toBe(false);
    expect(result.entries).toHaveLength(1);
  });

  it("degrades to an unavailable empty state when the table is missing", async () => {
    from.mockReturnValue(query({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.activity_log' in the schema cache" } }));
    await expect(getActivityLog("ws-1")).resolves.toEqual({ entries: [], isUnavailable: true });
  });

  it("builds the insert row with actor metadata", () => {
    expect(resolveActorName(" Ana ", { email: "a@b.c" })).toBe("Ana");
    expect(resolveActorName(null, { user_metadata: { full_name: "Ion" }, email: "a@b.c" })).toBe("Ion");
    expect(resolveActorName(null, { email: "a@b.c" })).toBe("a@b.c");
    expect(resolveActorName(null, null)).toBeNull();
    expect(buildActivityRow({ workspaceId: "ws", entityType: "order", entityId: "o1", event: "order.status_changed" }, { id: "u1", email: "a@b.c" })).toEqual({
      workspace_id: "ws",
      actor_user_id: "u1",
      actor_name: "a@b.c",
      entity_type: "order",
      entity_id: "o1",
      event: "order.status_changed",
      details: {},
    });
  });

  it("recordActivity inserts and resolves the actor", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert });
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } } });
    await expect(recordActivity({ workspaceId: "ws", entityType: "order", entityId: "o1", event: "e", details: { x: 1 } })).resolves.toEqual({ recorded: true });
    expect(from).toHaveBeenCalledWith("activity_log");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws", actor_user_id: "u1", actor_name: "a@b.c", details: { x: 1 } }));
  });

  it("recordActivity swallows missing table, RLS denial and thrown errors", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { code: "PGRST205", message: "schema cache" } }) });
    await expect(recordActivity({ workspaceId: "ws", entityType: "order", event: "e" })).resolves.toEqual({ recorded: false });
    from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { code: "42501", message: "row-level security" } }) });
    await expect(recordActivity({ workspaceId: "ws", entityType: "order", event: "e" })).resolves.toEqual({ recorded: false });
    from.mockReturnValue({ insert: vi.fn().mockRejectedValue(new Error("network")) });
    await expect(recordActivity({ workspaceId: "ws", entityType: "order", event: "e" })).resolves.toEqual({ recorded: false });
    getUser.mockRejectedValue(new Error("auth down"));
    from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    await expect(recordActivity({ workspaceId: "ws", entityType: "order", event: "e" })).resolves.toEqual({ recorded: true });
  });

  it("recordActivity skips without a workspace", async () => {
    await expect(recordActivity({ workspaceId: undefined, entityType: "order", event: "e" })).resolves.toEqual({ recorded: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("throws for other errors", async () => {
    from.mockReturnValue(query({ data: null, error: { code: "XX000", message: "boom" } }));
    await expect(getActivityLog("ws-1")).rejects.toThrow("boom");
  });
});
