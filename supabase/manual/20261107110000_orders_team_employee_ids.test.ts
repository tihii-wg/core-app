import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261107110000_orders_team_employee_ids.PRODUCTION.sql"),
  "utf8",
);

describe("orders_team_employee_ids SQL", () => {
  it("defines a security-invoker computed field over responsible, team and line performers", () => {
    expect(sql).toMatch(/create or replace function public\.team_employee_ids\(o public\.orders\)/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/from public\.order_employees e where e\.order_id = o\.id/);
    expect(sql).toMatch(/from public\.order_services s where s\.order_id = o\.id and s\.technician_id is not null/);
  });
  it("adds indexes and reloads the PostgREST schema", () => {
    expect(sql).toMatch(/order_services_order_technician_idx/);
    expect(sql).toMatch(/notify pgrst, 'reload schema'/);
    expect(sql).not.toMatch(/security definer/);
  });
});
