import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261110100000_order_custom_field_values_guard.PRODUCTION.sql"),
  "utf8",
);

describe("order_custom_field_values_guard SQL", () => {
  it("is transactional with loud preflight and postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/order_custom_field_values_guard preflight failed/);
    expect(sql).toMatch(/order_custom_field_values_guard postflight/);
  });

  it("creates the closed-order guard trigger and index", () => {
    expect(sql).toMatch(/create or replace function public\.custom_field_values_order_closed_guard\(/);
    expect(sql).toMatch(/custom_field_values_order_closed_guard_biud/);
    expect(sql).toMatch(/create index if not exists custom_field_values_workspace_definition_idx/);
    expect(sql).toMatch(/managed-object: core-app\/custom_field_values_order_closed_guard@v1/);
  });

  it("blocks closed orders with manage-closed / cancelled+owner bypass and workspace check", () => {
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders/);
    expect(sql).toMatch(/crm_owner_may_edit_cancelled_order/);
    expect(sql).toMatch(/custom_field_values:workspace_mismatch/);
    expect(sql).toMatch(/order_lifecycle:closed_order_immutable/);
    expect(sql).toMatch(/entity <> 'order'/);
  });
});
