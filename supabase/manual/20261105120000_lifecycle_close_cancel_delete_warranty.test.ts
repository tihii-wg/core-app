import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "./20261105120000_lifecycle_close_cancel_delete_warranty.PRODUCTION.sql"),
  "utf8",
);

describe("20261105120000 lifecycle close/cancel/delete warranty SQL", () => {
  it("close clears stale custom_status_id instead of coalescing", () => {
    expect(sql).toMatch(/create or replace function public\.close_order_if_settled/);
    expect(sql).toMatch(/status = ''closed''/);
    expect(sql).toMatch(/custom_status_id = \$1/);
    expect(sql).not.toMatch(/custom_status_id = coalesce\(\$1,\s*o\.custom_status_id\)/);
    expect(sql).toMatch(/crm_is_workspace_owner_id/);
    expect(sql).toMatch(/'status',\s*'closed'/);
  });

  it("delete removes exclusive warranty_records after dependency checks", () => {
    expect(sql).toMatch(/delete from public\.warranty_records wr/);
    expect(sql).toMatch(/order_delete_blocked_by_warranty|has_warranty_orders/);
    expect(sql).toMatch(/has_warranty_claims/);
    expect(sql).not.toMatch(/drop constraint warranty_records_order_id_fkey/);
    expect(sql).toMatch(/still ON DELETE RESTRICT/);
  });

  it("retains material auto-return for closed-then-cancelled deletes", () => {
    expect(sql).toMatch(/return_order_materials_to_warehouse/);
    expect(sql).toMatch(/still raises issued_materials_on_closed_order/);
    expect(sql).not.toMatch(/raise exception 'order_delete:issued_materials_on_closed_order'/);
  });
});
