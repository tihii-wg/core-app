import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { op: "update" | "insert" | "select"; payload?: Record<string, unknown> };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  rowExists: false,
  insertError: null as null | { code: string; message: string },
}));

// Column privileges from supabase/manual/20261107140000_workspace_backups.PRODUCTION.sql
const INSERT_COLUMNS = new Set([
  "workspace_id", "provider", "enabled", "frequency", "hour_utc", "weekday", "retention_count", "include_files",
  "github_repo", "github_branch", "github_path", "google_folder_id",
]);
const UPDATE_COLUMNS = new Set([
  "provider", "enabled", "frequency", "hour_utc", "weekday", "retention_count", "include_files",
  "github_repo", "github_branch", "github_path", "google_folder_id", "updated_at",
]);

vi.mock("./supabase", () => {
  const settingsRow = {
    workspace_id: "ws-1",
    provider: "github",
    enabled: true,
    frequency: "daily",
    hour_utc: 1,
    weekday: 0,
    retention_count: 14,
    include_files: true,
  };
  const from = (table: string) => {
    if (table !== "workspace_backup_settings") throw new Error(`unexpected table ${table}`);
    return {
      update(payload: Record<string, unknown>) {
        state.calls.push({ op: "update", payload });
        return {
          eq: () => ({
            select: async () => ({ data: state.rowExists ? [{ workspace_id: "ws-1" }] : [], error: null }),
          }),
        };
      },
      async insert(payload: Record<string, unknown>) {
        state.calls.push({ op: "insert", payload });
        if (state.insertError) {
          const error = state.insertError;
          state.insertError = null;
          state.rowExists = true;
          return { error };
        }
        state.rowExists = true;
        return { error: null };
      },
      upsert() {
        throw new Error("upsert must not be used: it violates column privileges");
      },
      select() {
        state.calls.push({ op: "select" });
        return { eq: () => ({ maybeSingle: async () => ({ data: state.rowExists ? settingsRow : null, error: null }) }) };
      },
    };
  };
  return { default: { from, rpc: async () => ({ data: true, error: null }) } };
});

import { updateBackupSettings } from "./apiBackups";

function writes() {
  return state.calls.filter((c) => c.op !== "select");
}

describe("updateBackupSettings respects column privileges", () => {
  beforeEach(() => {
    state.calls = [];
    state.rowExists = false;
    state.insertError = null;
  });

  it("inserts the first row without updated_at", async () => {
    const result = await updateBackupSettings("ws-1", { provider: "github", enabled: true, githubRepo: "me/backups" });
    expect(writes().map((c) => c.op)).toEqual(["update", "insert"]);
    const insert = writes()[1].payload!;
    expect(insert.workspace_id).toBe("ws-1");
    for (const column of Object.keys(insert)) expect(INSERT_COLUMNS.has(column)).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it("updates an existing row without touching workspace_id", async () => {
    state.rowExists = true;
    await updateBackupSettings("ws-1", { enabled: false, frequency: "weekly" });
    expect(writes().map((c) => c.op)).toEqual(["update"]);
    const update = writes()[0].payload!;
    for (const column of Object.keys(update)) expect(UPDATE_COLUMNS.has(column)).toBe(true);
    expect(update).toMatchObject({ enabled: false, frequency: "weekly" });
  });

  it("falls back to update when the row was created concurrently", async () => {
    state.insertError = { code: "23505", message: "duplicate key" };
    await updateBackupSettings("ws-1", { enabled: true });
    expect(writes().map((c) => c.op)).toEqual(["update", "insert", "update"]);
  });
});
