import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108120000_closed_orders_immutable.PRODUCTION.sql"),
  "utf8",
);

const fn = (name: string) => {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  expect(i).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("$fn$;", i));
};

describe("closed_orders_immutable SQL", () => {
  it("removes the owner bypass for closed order contents", () => {
    expect(fn("crm_owner_may_manage_closed_orders")).toMatch(/select false;/);
  });

  it("keeps owner cancel/delete of closed orders without the manage function", () => {
    const body = fn("crm_has_closed_order_permission");
    expect(body).not.toMatch(/crm_owner_may_manage_closed_orders/);
    expect(body).toMatch(/w\.owner_can_manage_closed_orders/);
    expect(body).toMatch(/w\.owner_id = auth\.uid\(\)/);
    expect(body).toMatch(/'orders\.cancel_closed', 'orders\.delete_closed'/);
  });

  it("cleans up the withdrawn auto-reopen draft and changes no data", () => {
    expect(sql).toMatch(/drop trigger if exists crm_orders_reopen_underpaid_au on public\.orders;/);
    expect(sql).not.toMatch(/\bupdate public\.(orders|payments|order_services|order_materials)\b/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });
});
