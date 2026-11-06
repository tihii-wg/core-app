import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106170000_auto_default_finance_accounts.PRODUCTION.sql"),
  "utf8",
);

describe("auto_default_finance_accounts SQL", () => {
  it("creates default accounts only for workspaces without accounts", () => {
    expect(sql).toMatch(/create or replace function public\.crm_ensure_default_finance_accounts/);
    expect(sql).toMatch(/'Касса \(наличные\)', 'cash'/);
    expect(sql).toMatch(/'Банковский счёт', 'cashless'/);
    expect(sql).toMatch(/where a\.workspace_id = p_workspace_id and a\.deleted_at is null/);
  });

  it("installs insert + currency triggers and backfills", () => {
    expect(sql).toMatch(/after insert on public\.workspaces/);
    expect(sql).toMatch(/after update of currency on public\.workspaces/);
    expect(sql).toMatch(/for v_ws in select id from public\.workspaces where deleted_at is null loop/);
  });

  it("never changes accounts that already have money movements", () => {
    expect(sql).toMatch(/not exists \(\s*select 1 from public\.finance_transactions t/);
    expect(sql).not.toMatch(/delete from public\.finance_accounts/i);
  });
});
