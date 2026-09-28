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
    from.mockReset();
  });

  it("reads a whole-number markup percentage from the workspace", async () => {
    from.mockImplementation(() => query({ data: { inventory_markup: "25" }, error: null }));

    await expect(getInventoryMarkup("ws-1")).resolves.toBe(25);
  });

  it("treats a missing markup as zero", async () => {
    from.mockImplementation(() => query({ data: { inventory_markup: null }, error: null }));

    await expect(getInventoryMarkup("ws-1")).resolves.toBe(0);
  });

  it("saves the markup percentage on the workspace", async () => {
    from.mockImplementation(() => query({ data: { inventory_markup: 25 }, error: null }));

    await expect(updateInventoryMarkup("ws-1", 25)).resolves.toBe(25);
  });

  it("rejects a negative markup", async () => {
    await expect(updateInventoryMarkup("ws-1", -1)).rejects.toThrow("Markup percentage cannot be negative");
    expect(from).not.toHaveBeenCalled();
  });
});
