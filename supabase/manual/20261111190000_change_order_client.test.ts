import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261111190000_change_order_client.PRODUCTION.sql"),
  "utf8",
);

const fn = (name: string) => {
  const needle = `create or replace function public.${name}(`;
  const i = sql.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  const end = sql.indexOf("$fn$;", i);
  expect(end).toBeGreaterThan(i);
  return sql.slice(i, end);
};

describe("change_order_client SQL", () => {
  it("is transactional with loud preflight and postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/change_order_client preflight failed/);
    expect(sql).toMatch(/change_order_client postflight failed/);
  });

  it("creates crm_change_order_client with grants", () => {
    expect(sql).toMatch(/create or replace function public\.crm_change_order_client\(/);
    expect(sql).toMatch(/grant execute on function public\.crm_change_order_client/);
    expect(sql).toMatch(/revoke all on function public\.crm_change_order_client/);
    expect(sql).toMatch(/is_workspace_member/);
    expect(sql).not.toMatch(/crm_is_workspace_member/);
  });

  it("validates vehicle against the new client and refuses closed/cancelled", () => {
    const body = fn("crm_change_order_client");
    expect(body).toMatch(/vehicle_not_assignable/);
    expect(body).toMatch(/v\.client_id = p_client_id/);
    expect(body).toMatch(/closed_order_immutable/);
    expect(body).toMatch(/cancelled_order_immutable/);
    expect(body).toMatch(/for update/);
  });

  it("moves payer only when it matched the old client and requires invoice confirm", () => {
    const body = fn("crm_change_order_client");
    expect(body).toMatch(/payer_client_id/);
    expect(body).toMatch(/invoice_confirm_required/);
    expect(body).toMatch(/client_changed/);
    expect(body).toMatch(/vehicle_changed/);
    expect(body).toMatch(/crm_order_event_insert/);
  });
});
