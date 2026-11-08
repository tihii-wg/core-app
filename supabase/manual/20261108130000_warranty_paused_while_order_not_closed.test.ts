import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108130000_warranty_paused_while_order_not_closed.PRODUCTION.sql"),
  "utf8",
);

describe("warranty_paused_while_order_not_closed SQL", () => {
  it("treats a warranty as valid only while the source order is formally closed", () => {
    expect(sql).toMatch(/select o\.status = 'closed' and o\.closed_at is not null/);
  });

  it("rejects new active claims against paused warranties", () => {
    expect(sql).toMatch(/before insert or update on public\.warranty_order_claims/);
    expect(sql).toMatch(/raise exception 'warranty:paused_source_not_closed'/);
    expect(sql).toMatch(/if coalesce\(new\.is_active, true\) = false then\s+return new;/);
  });

  it("changes no data and is transactional", () => {
    expect(sql).not.toMatch(/\bupdate public\.|delete from|insert into public\./i);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });
});
