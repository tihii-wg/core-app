import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112210000_vehicle_mileage_intake.PRODUCTION.sql"),
  "utf8",
);

describe("vehicle_mileage_intake SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/vehicle_mileage_intake preflight/);
    expect(sql).toMatch(/vehicle_mileage_intake postflight/);
  });

  it("adds orders.vehicle_mileage_confirmed default false", () => {
    expect(sql).toMatch(/add column if not exists vehicle_mileage_confirmed boolean/);
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
