import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108120000_closed_order_underpaid_reopen.PRODUCTION.sql"),
  "utf8",
);

describe("closed_order_underpaid_reopen SQL", () => {
  it("lets a reopen token clear closed_at when leaving closed or cancelled", () => {
    expect(sql).toMatch(/and old\.status in \('cancelled', 'closed'\)/);
    expect(sql).toMatch(/order_lifecycle:cannot_clear_closed_at/);
    expect(sql).toMatch(/order_lifecycle_guard@v4/);
  });

  it("reopens only when a closed order's total grows above net paid", () => {
    expect(sql).toMatch(/after update of total_price on public\.orders/);
    expect(sql).toMatch(/if coalesce\(new\.total_price, 0\) <= coalesce\(old\.total_price, 0\) then\s+return null;/);
    expect(sql).toMatch(/round\(coalesce\(new\.total_price, 0\), 2\) <= round\(v_net, 2\) \+ 0\.005/);
    expect(sql).toMatch(/set status = ''in-progress''/);
    expect(sql).toMatch(/closed_at = null/);
  });

  it("uses the reopen token and always removes it", () => {
    expect(sql).toMatch(/insert into public\.order_lifecycle_tokens \(order_id, op, created_by\)\s+values \(new\.id, 'reopen'/);
    expect((sql.match(/delete from public\.order_lifecycle_tokens where order_id = new\.id and op = 'reopen';/g) ?? []).length).toBe(2);
  });

  it("does not modify payments or backfill orders", () => {
    expect(sql).not.toMatch(/update public\.payments|delete from public\.payments|insert into public\.payments/i);
    expect(sql).toMatch(/underpaid closed orders \(not changed\)/);
  });
});
