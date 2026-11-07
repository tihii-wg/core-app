import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261107090000_warranty_mileage_unit.PRODUCTION.sql"),
  "utf8",
);

describe("warranty_mileage_unit SQL", () => {
  it("adds a km|mi unit column with a check", () => {
    expect(sql).toMatch(/add column if not exists mileage_unit text/);
    expect(sql).toMatch(/mileage_unit in \('km', 'mi'\)/);
  });
  it("fills the unit on insert from the order snapshot / vehicle and backfills", () => {
    expect(sql).toMatch(/before insert on public\.warranty_records/);
    expect(sql).toMatch(/vehicle_mileage_unit_snapshot/);
    expect(sql).toMatch(/where wr\.mileage_unit is null/);
  });
  it("never converts stored numbers", () => {
    expect(sql).not.toMatch(/set\s+mileage_limit/i);
    expect(sql).not.toMatch(/set\s+start_mileage/i);
    expect(sql).not.toMatch(/1\.609/);
  });
});
