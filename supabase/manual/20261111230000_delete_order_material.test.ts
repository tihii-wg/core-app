import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261111230000_delete_order_material.PRODUCTION.sql"),
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

describe("delete_order_material SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/delete_order_material preflight failed/);
    expect(sql).toMatch(/delete_order_material postflight failed/);
  });

  it("creates crm_delete_order_material with membership check", () => {
    expect(sql).toMatch(/create or replace function public\.crm_delete_order_material\(/);
    expect(sql).toMatch(/grant execute on function public\.crm_delete_order_material/);
    expect(sql).toMatch(/is_workspace_member/);
    expect(sql).not.toMatch(/crm_is_workspace_member/);
  });

  it("returns outstanding stock then deletes the line and recalculates totals", () => {
    const body = fn("crm_delete_order_material");
    expect(body).toMatch(/return_order_materials_to_warehouse/);
    expect(body).toMatch(/delete from public\.order_materials/);
    expect(body).toMatch(/closed_order_immutable/);
    expect(body).toMatch(/cancelled_order_immutable/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/material_removed/);
    expect(body).toMatch(/discount_total/);
    expect(body).toMatch(/total_price/);
  });
});
