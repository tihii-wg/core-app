import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261105160000_catalog_warranty_defaults.PRODUCTION.sql");

describe("catalog warranty defaults SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("adds warranty_type/months to services and warranty_type/months/km to inventory_items", () => {
    expect(sql).toMatch(/alter table public\.services/i);
    expect(sql).toMatch(/add column if not exists warranty_type text/i);
    expect(sql).toMatch(/add column if not exists warranty_months integer/i);
    expect(sql).toMatch(/alter table public\.inventory_items/i);
    expect(sql).toMatch(/inventory_items[\s\S]*warranty_km/i);
  });

  it("constrains type shape and rejects zero/negative limits", () => {
    expect(sql).toMatch(/services_warranty_defaults_shape_check/);
    expect(sql).toMatch(/inventory_items_warranty_defaults_shape_check/);
    expect(sql).toMatch(/warranty_months is null or warranty_months > 0/);
    expect(sql).toMatch(/warranty_km is null or warranty_km > 0/);
    expect(sql).toMatch(/'none',\s*'duration',\s*'mileage',\s*'both'/);
  });

  it("recreates inventory_items_with_status via drop/create and re-grants", () => {
    expect(sql).toMatch(/drop view if exists public\.inventory_items_with_status/i);
    expect(sql).toMatch(/create view public\.inventory_items_with_status/i);
    expect(sql).toMatch(/i\.warranty_type/);
    expect(sql).toMatch(/grant select.*inventory_items_with_status to authenticated/i);
  });

  it("does not redefine activate_order_warranties or rewrite warranty_records", () => {
    expect(sql).not.toMatch(/create or replace function public\.activate_order_warranties/i);
    expect(sql).not.toMatch(/update public\.warranty_records/i);
    expect(sql).not.toMatch(/update public\.order_services/i);
    expect(sql).not.toMatch(/update public\.order_materials/i);
  });

  it("includes preflight and postflight checks", () => {
    expect(sql).toMatch(/catalog_warranty_defaults preflight failed/);
    expect(sql).toMatch(/catalog_warranty_defaults postflight failed/);
    expect(sql).toMatch(/activate_order_warranties/);
  });
});
