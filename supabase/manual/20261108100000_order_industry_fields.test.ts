import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108100000_order_industry_fields.PRODUCTION.sql"),
  "utf8",
);

describe("order_industry_fields SQL", () => {
  it("adds nullable industry columns idempotently", () => {
    for (const col of [
      "device_serial", "device_imei", "device_condition", "device_completeness", "device_passcode",
      "site_address", "product_dimensions",
    ]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${col} text;`));
    }
    expect(sql).toMatch(/add column if not exists measurement_at timestamptz;/);
    expect(sql).toMatch(/add column if not exists installation_at timestamptz;/);
  });

  it("adds length checks and install-after-measure check", () => {
    expect(sql).toMatch(/char_length\(%I\) <= %s/);
    expect(sql).toMatch(/installation_at >= measurement_at/);
  });

  it("is transactional and never updates or deletes data", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).not.toMatch(/\bupdate public\.orders\b/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).not.toMatch(/drop column/i);
  });
});
