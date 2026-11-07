import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261107100000_order_team_and_line_technicians.PRODUCTION.sql"),
  "utf8",
);

describe("order_team_and_line_technicians SQL", () => {
  it("adds line performer, catalog default performer and the order team table", () => {
    expect(sql).toMatch(/add column if not exists technician_id uuid references public\.employees/);
    expect(sql).toMatch(/add column if not exists default_technician_id uuid references public\.employees/);
    expect(sql).toMatch(/create table if not exists public\.order_employees/);
    expect(sql).toMatch(/constraint order_employees_unique unique \(order_id, employee_id\)/);
  });
  it("protects with RLS, closed-order guard and workspace consistency", () => {
    expect(sql).toMatch(/alter table public\.order_employees enable row level security/);
    expect(sql).toMatch(/execute function public\.order_services_closed_guard\(\)/);
    expect(sql).toMatch(/order_team:workspace_mismatch/);
    expect(sql).toMatch(/order_team:technician_workspace_mismatch/);
    expect(sql).toMatch(/revoke all on table public\.order_employees from public, anon/);
  });
});
