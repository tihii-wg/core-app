import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMigrationPreview, MIGRATION_PREVIEW_TABLES, toPreviewRow } from "./apiMigrationPreview";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

type CountResult = { count: number | null; error: { message?: string; code?: string } | null };

function countQuery(resolve: (calls: string[]) => CountResult) {
  const calls: string[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: (column: string) => {
      calls.push(`is:${column}`);
      return chain;
    },
    then: (onFulfilled: (value: CountResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve(calls)).then(onFulfilled, onRejected),
  };
  return chain;
}

describe("apiMigrationPreview", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("requires an active workspace", async () => {
    await expect(getMigrationPreview(undefined)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it("only reads Core tables and never writes", async () => {
    const methods = new Set<string>();
    from.mockImplementation(() => {
      const chain = countQuery(() => ({ count: 3, error: null }));
      for (const key of Object.keys(chain)) methods.add(key);
      return chain;
    });

    const rows = await getMigrationPreview("ws-1");
    expect(rows).toHaveLength(MIGRATION_PREVIEW_TABLES.length);
    expect(rows.every((row) => row.status === "ok" && row.count === 3)).toBe(true);
    expect([...methods].filter((method) => ["insert", "update", "upsert", "delete", "rpc"].includes(method))).toEqual([]);
  });

  it("maps missing tables, permission errors and other errors per table", () => {
    const entry = { table: "locations", group: "roSchema" } as const;
    expect(toPreviewRow(entry, { count: 5, error: null })).toMatchObject({ status: "ok", count: 5 });
    expect(toPreviewRow(entry, { count: null, error: { code: "PGRST205", message: "no table" } })).toMatchObject({ status: "missing", count: null });
    expect(toPreviewRow(entry, { count: null, error: { code: "42P01", message: "x" } })).toMatchObject({ status: "missing" });
    expect(toPreviewRow(entry, { count: null, error: { code: "42501", message: "permission denied for table locations" } })).toMatchObject({ status: "restricted" });
    expect(toPreviewRow(entry, { count: null, error: { code: "XX000", message: "boom" } })).toMatchObject({ status: "error", message: "boom" });
  });

  it("falls back to a plain count when deleted_at does not exist", async () => {
    from.mockImplementation((table: string) =>
      countQuery((calls) =>
        table === "clients" && calls.includes("is:deleted_at")
          ? { count: null, error: { code: "42703", message: 'column "deleted_at" does not exist' } }
          : { count: 9, error: null },
      ),
    );

    const rows = await getMigrationPreview("ws-1");
    expect(rows.find((row) => row.table === "clients")).toMatchObject({ status: "ok", count: 9 });
  });

  it("keeps going when one table fails", async () => {
    from.mockImplementation((table: string) =>
      countQuery(() => (table === "expenses" ? { count: null, error: { code: "PGRST205", message: "missing" } } : { count: 1, error: null })),
    );

    const rows = await getMigrationPreview("ws-1");
    expect(rows.find((row) => row.table === "expenses")?.status).toBe("missing");
    expect(rows.find((row) => row.table === "orders")?.status).toBe("ok");
  });
});
