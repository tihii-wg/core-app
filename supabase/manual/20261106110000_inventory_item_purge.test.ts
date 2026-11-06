import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106110000_inventory_item_purge.PRODUCTION.sql"),
  "utf8",
);

describe("inventory_item_purge SQL", () => {
  it("adds a read-only preview and an owner-only purge RPC", () => {
    expect(sql).toMatch(/create or replace function public\.crm_inventory_item_delete_preview\(p_item_id uuid\)/);
    expect(sql).toMatch(/create or replace function public\.crm_purge_inventory_item\(p_item_id uuid\)/);
    expect(sql).toMatch(/inventory_item_purge:owner_only/);
    expect(sql).toMatch(/crm_is_workspace_owner_id\(v_item\.workspace_id\)/);
    expect(sql).toMatch(/revoke all on function public\.crm_purge_inventory_item\(uuid\) from public, anon/);
  });

  it("refuses when non-cancelled orders use the item and detaches cancelled-order lines", () => {
    expect(sql).toMatch(/inventory_item_purge:used_in_orders/);
    expect(sql).toMatch(/o\.status is distinct from 'cancelled'/);
    expect(sql).toMatch(/supply_source = 'one_time'/);
  });

  it("removes stock traces but keeps posted documents", () => {
    expect(sql).toMatch(/delete from public\.inventory_movements where inventory_item_id = p_item_id/);
    expect(sql).toMatch(/delete from public\.warehouse_stock where inventory_item_id = p_item_id/);
    expect(sql).toMatch(/gr\.status is distinct from 'posted'/);
    expect(sql).toMatch(/t\.posted_at is null/);
    expect(sql).toMatch(/w\.posted_at is null/);
    expect(sql).not.toMatch(/delete from public\.goods_receipts\b/);
    expect(sql).not.toMatch(/delete from public\.finance_transactions/);
  });

  it("keeps the existing delete guard trigger", () => {
    expect(sql).not.toMatch(/drop trigger if exists inventory_items_clear_denied_stock_children/);
    expect(sql).toMatch(/inventory delete guard trigger must remain/);
  });
});
