import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108090000_industry_furniture_manufacturing.PRODUCTION.sql"),
  "utf8",
);

describe("industry_furniture_manufacturing SQL", () => {
  it("inserts the furniture industry idempotently", () => {
    expect(sql).toMatch(/insert into public\.industries \(name, slug, description, is_active\)/);
    expect(sql).toMatch(/'furniture_manufacturing'/);
    expect(sql).toMatch(/on conflict \(slug\) do update/);
  });

  it("never deletes or deactivates other industries", () => {
    expect(sql).not.toMatch(/delete from public\.industries/i);
    expect(sql).not.toMatch(/is_active\s*=\s*false/i);
  });
});
