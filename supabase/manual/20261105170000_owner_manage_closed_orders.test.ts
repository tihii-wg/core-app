import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261105170000_owner_manage_closed_orders.PRODUCTION.sql");

describe("owner manage closed orders SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("adds owner_can_manage_closed_orders default false", () => {
    expect(sql).toMatch(/owner_can_manage_closed_orders boolean/i);
    expect(sql).toMatch(/set default false/i);
    expect(sql).toMatch(/set not null/i);
  });

  it("gates the helper on workspaces.owner_id and the setting", () => {
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders/);
    expect(sql).toMatch(/w\.owner_id = auth\.uid\(\)/);
    expect(sql).toMatch(/owner_can_manage_closed_orders/);
  });

  it("patches order_lifecycle_guard with owner-manage bypass without clearing closed_at", () => {
    expect(sql).toMatch(/order_lifecycle_guard/);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders/);
    expect(sql).toMatch(/cannot_clear_closed_at/);
    expect(sql).toMatch(/closed_order_immutable/);
  });

  it("allows apply_order_material_warranties after close only for owner manage", () => {
    expect(sql).toMatch(/apply_order_material_warranties/);
    expect(sql).toMatch(/p_order_id uuid,\s*p_workspace_id uuid/s);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders\(p_workspace_id\)/);
  });

  it("includes preflight and postflight", () => {
    expect(sql).toMatch(/owner_manage_closed_orders preflight failed/);
    expect(sql).toMatch(/owner_manage_closed_orders postflight failed/);
  });
});
