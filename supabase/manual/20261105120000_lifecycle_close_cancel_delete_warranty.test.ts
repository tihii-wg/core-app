import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "./20261105120000_lifecycle_close_cancel_delete_warranty.PRODUCTION.sql"),
  "utf8",
);

describe("20261105120000 lifecycle close/cancel/delete warranty SQL", () => {
  it("strengthens preflight for warranty tables, FKs, and delete trigger helper", () => {
    expect(sql).toMatch(/warranty_records\.order_id FK must remain RESTRICT/);
    expect(sql).toMatch(/trg_orders_block_delete_with_warranty/);
    expect(sql).toMatch(/order_delete_blocked_by_warranty missing \(required by trg_orders_block_delete_with_warranty\)/);
    expect(sql).toMatch(/warranty_order_claims\.%s missing/);
    expect(sql).toMatch(/order_lifecycle_guard missing/);
    expect(sql).toMatch(/close_order_if_settled missing/);
  });

  it("close clears stale custom_status_id and repairs idempotent closed rows", () => {
    expect(sql).toMatch(/create or replace function public\.close_order_if_settled/);
    expect(sql).toMatch(/status = ''closed''/);
    expect(sql).toMatch(/custom_status_id = \$1/);
    // First-close dynamic UPDATE must assign $1 directly (not coalesce with existing).
    expect(sql).toMatch(/custom_status_id = \$1%s%s/);
    expect(sql).toMatch(/custom_status_id = \$1%s/);
    expect(sql).not.toMatch(/custom_status_id = coalesce\(\$1,\s*o\.custom_status_id\)%s/);
    expect(sql).toMatch(/crm_is_workspace_owner_id/);
    expect(sql).toMatch(/'status',\s*'closed'/);
    expect(sql).toMatch(/o\.closed_at is not distinct from v_order\.closed_at/);
    expect(sql).toMatch(/v_order\.status is distinct from 'closed'/);
  });

  it("delete removes exclusive warranty_records after dependency checks", () => {
    expect(sql).toMatch(/delete from public\.warranty_records wr/);
    expect(sql).toMatch(/wr\.workspace_id = p_workspace_id/);
    expect(sql).toMatch(/wr\.order_id = p_order_id/);
    expect(sql).toMatch(/delete from public\.warranty_order_claims c/);
    expect(sql).toMatch(/c\.warranty_order_id = p_order_id/);
    expect(sql).toMatch(/order_delete_blocked_by_warranty|has_warranty_orders/);
    expect(sql).toMatch(/has_warranty_claims/);
    expect(sql).not.toMatch(/drop constraint warranty_records_order_id_fkey/);
    expect(sql).toMatch(/still RESTRICT/);
  });

  it("retains material auto-return for closed-then-cancelled deletes", () => {
    expect(sql).toMatch(/return_order_materials_to_warehouse/);
    expect(sql).toMatch(/still raises issued_materials_on_closed_order/);
    expect(sql).not.toMatch(/raise exception 'order_delete:issued_materials_on_closed_order'/);
  });

  it("postflight asserts behavioral snippets not only function names", () => {
    expect(sql).toMatch(/warranty_records delete not scoped to workspace_id\+order_id/);
    expect(sql).toMatch(/idempotent close missing closed_at preservation guard/);
    expect(sql).toMatch(/close still coalesces stale custom_status_id/);
  });
});
