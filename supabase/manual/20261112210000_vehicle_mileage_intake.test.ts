import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112210000_vehicle_mileage_intake.PRODUCTION.sql"),
  "utf8",
);

describe("vehicle_mileage_intake SQL", () => {
  it("runs as a single DO block with loud preflight/postflight", () => {
    expect(sql).not.toMatch(/^begin;/m);
    expect(sql).toMatch(/^do \$intake\$/m);
    expect(sql.match(/^do \$/gm)).toHaveLength(1);
    expect(sql).toMatch(/vehicle_mileage_intake preflight/);
    expect(sql).toMatch(/vehicle_mileage_intake postflight/);
  });

  it("adds orders.vehicle_mileage_confirmed default false", () => {
    // Added together with the default so closed orders are filled without firing their guard trigger.
    expect(sql).toMatch(/add column vehicle_mileage_confirmed boolean not null default false/);
    expect(sql).not.toMatch(/^update public\.orders/m);
    expect(sql).toMatch(/enable trigger orders_closed_content_guard_bu/);
    expect(sql).toMatch(/alter column vehicle_mileage_confirmed set default false/);
    expect(sql).toMatch(/alter column vehicle_mileage_confirmed set not null/);
  });

  it("backfills vehicles.current_mileage from initial_mileage", () => {
    expect(sql).toMatch(/set current_mileage = initial_mileage/);
    expect(sql).toMatch(/current_mileage is null/);
    expect(sql).toMatch(/initial_mileage is not null/);
  });

  it("patches close_order_if_settled after warranty activation with never-decrease update", () => {
    expect(sql).toMatch(/pg_get_functiondef\('public\.close_order_if_settled\(uuid,uuid\)'/);
    expect(sql).toMatch(/20261112210000/);
    expect(sql).toMatch(/greatest\(/);
    expect(sql).toMatch(/vehicle_mileage_snapshot/);
    expect(sql).toMatch(/1\.609344/);
  });
});
