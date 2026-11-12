import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112140000_order_line_rpcs.PRODUCTION.sql"),
  "utf8",
);

const fn = (name: string) => {
  const needle = `create or replace function public.${name}(`;
  const i = sql.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  const end = sql.indexOf("$fn$;", i);
  expect(end).toBeGreaterThan(i);
  return sql.slice(i, end);
};

describe("order_line_rpcs SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/order_line_rpcs preflight failed/);
    expect(sql).toMatch(/order_line_rpcs postflight failed/);
  });

  it("creates crm_get_order_full with membership check and full payload keys", () => {
    const body = fn("crm_get_order_full");
    expect(body).toMatch(/is_workspace_member/);
    expect(body).toMatch(/set search_path = pg_catalog, public/);
    expect(body).toMatch(/'services'/);
    expect(body).toMatch(/'materials'/);
    expect(body).toMatch(/'team'/);
    expect(body).toMatch(/'employees'/);
    expect(body).toMatch(/'member_names'/);
    expect(body).toMatch(/'custom_status'/);
    expect(sql).toMatch(/grant execute on function public\.crm_get_order_full\(uuid\) to authenticated/);
    expect(sql).not.toMatch(/grant execute on function public\.crm_get_order_full\(uuid\) to authenticated, service_role/);
  });

  it("creates service line RPCs that lock the order and return crm_get_order_full", () => {
    for (const name of [
      "crm_add_order_service_line",
      "crm_update_order_service_line",
      "crm_delete_order_service_line",
    ] as const) {
      const body = fn(name);
      expect(body).toMatch(/for update/);
      expect(body).toMatch(/closed_order_immutable/);
      expect(body).toMatch(/cancelled_order_immutable/);
      expect(body).toMatch(/crm_get_order_full/);
      expect(body).toMatch(/crm_recalc_order_line_totals|total_price/);
    }
    expect(fn("crm_add_order_service_line")).toMatch(/service_order/);
    expect(fn("crm_add_order_service_line")).toMatch(/duplicate_line_id/);
    expect(fn("crm_update_order_service_line")).toMatch(/crm_sync_order_employees_from_lines/);
  });

  it("extends material RPCs to return full order and keeps stock error codes", () => {
    const qty = fn("crm_change_order_material_quantity");
    expect(qty).toMatch(/crm_get_order_full/);
    expect(qty).toMatch(/order_material:insufficient_stock available=% requested=%/);
    expect(fn("crm_delete_order_material")).toMatch(/crm_get_order_full/);
    expect(fn("crm_set_order_material_prices")).toMatch(/crm_get_order_full/);
    expect(fn("crm_set_order_material_prices")).toMatch(/per-line discount/);
  });

  it("creates catalog add-and-issue RPC with stock cap", () => {
    const body = fn("crm_add_and_issue_order_catalog_material");
    expect(body).toMatch(/warehouse_stock/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/order_material:insufficient_stock available=% requested=%/);
    expect(body).toMatch(/issue_order_materials_from_warehouse/);
    expect(body).toMatch(/crm_get_order_full/);
    expect(body).toMatch(/warehouse_permission/);
  });
});
