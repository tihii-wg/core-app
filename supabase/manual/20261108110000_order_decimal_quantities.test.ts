import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108110000_order_decimal_quantities.PRODUCTION.sql"),
  "utf8",
);

const body = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$function$;", start));
};

describe("order_decimal_quantities SQL", () => {
  it("converts order_services.quantity to numeric(12,2) with a positive check", () => {
    expect(sql).toMatch(/alter column quantity type numeric\(12,2\) using quantity::numeric\(12,2\)/);
    expect(sql).toMatch(/order_services_quantity_positive check \(quantity > 0\) not valid/);
  });

  it("allows up to 2 decimals in every material quantity RPC", () => {
    for (const fn of [
      "sync_order_materials",
      "issue_order_materials_from_warehouse",
      "return_order_materials_to_warehouse",
      "add_and_issue_order_catalog_material",
      "set_order_catalog_material_quantity_with_issue",
    ]) {
      const b = body(fn);
      expect(b).not.toMatch(/whole number/);
      expect(b).not.toMatch(/trunc\(v_raw\)/);
      expect(b).not.toMatch(/'quantity'\)::integer/);
      expect(b).toMatch(/round\((v_raw|p_quantity), 2\)/);
    }
  });

  it("replaces the integer overloads of the catalog quantity RPCs", () => {
    expect(sql).toMatch(/drop function if exists public\.add_and_issue_order_catalog_material\(uuid, uuid, uuid, integer, numeric, text\);/);
    expect(sql).toMatch(/drop function if exists public\.set_order_catalog_material_quantity_with_issue\(uuid, uuid, uuid, integer, text\);/);
    expect(sql).toMatch(/grant execute on function public\.add_and_issue_order_catalog_material\(uuid, uuid, uuid, numeric, numeric, text\) to authenticated, service_role;/);
    expect(sql).toMatch(/grant execute on function public\.set_order_catalog_material_quantity_with_issue\(uuid, uuid, uuid, numeric, text\) to authenticated, service_role;/);
  });

  it("is transactional, has pre/postflight and never modifies data", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/\$preflight\$/);
    expect(sql).toMatch(/\$postflight\$/);
    // Migration DDL must not wipe line tables. Function bodies may still DELETE inside
    // sync/issue RPCs (copied from prerequisites) — strip $function$ … $function$ first.
    const withoutFunctionBodies = sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(withoutFunctionBodies).not.toMatch(/delete from public\.order_(services|materials)\b/i);
  });
});

describe("order_decimal_quantities SQL — order_materials", () => {
  it("converts integer order_materials quantity columns to numeric(12,2)", () => {
    expect(sql).toMatch(/'quantity', 'quantity_issued', 'quantity_returned'/);
    expect(sql).toMatch(/alter table public\.order_materials alter column %I type numeric\(12,2\)/);
  });
});
