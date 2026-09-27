import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInventoryMarkup, updateInventoryMarkup } from "./apiInventoryMarkup";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

describe("inventory markup api", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
    from.mockReset();
  });

  it("keeps the markup after refresh when the workspace column is not available yet", async () => {
    from.mockImplementation(() => query({ data: null, error: { code: "42703", message: "column workspaces.inventory_markup_percent does not exist" } }));

    await expect(updateInventoryMarkup("ws-1", 20)).resolves.toBe(20);
    await expect(getInventoryMarkup("ws-1")).resolves.toBe(20);
  });

  it("reads the markup stored on the workspace", async () => {
    from.mockImplementation(() => query({ data: { inventory_markup_percent: "15" }, error: null }));

    await expect(getInventoryMarkup("ws-1")).resolves.toBe(15);
  });
});
