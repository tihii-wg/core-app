import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261110090000_merge_clients.PRODUCTION.sql"),
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

describe("merge_clients SQL", () => {
  it("is transactional with loud preflight and postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/merge_clients preflight failed/);
    expect(sql).toMatch(/merge_clients postflight/);
  });

  it("adds merged_into_client_id and both RPCs", () => {
    expect(sql).toMatch(/add column if not exists merged_into_client_id uuid/);
    expect(sql).toMatch(/create or replace function public\.crm_merge_clients_preview\(/);
    expect(sql).toMatch(/create or replace function public\.crm_merge_clients\(/);
    expect(sql).toMatch(/grant execute on function public\.crm_merge_clients/);
    expect(sql).toMatch(/revoke all on function public\.crm_merge_clients/);
  });

  it("bumps closed-order guard with a narrow client_merge bypass", () => {
    const body = fn("orders_closed_content_guard");
    expect(body).toMatch(/crm\.client_merge/);
    expect(body).toMatch(/client_id/);
    expect(body).toMatch(/payer_client_id/);
    expect(sql).toMatch(/orders_closed_content_guard@v3/);
  });

  it("discovers FKs dynamically and handles client_discounts uniqueness", () => {
    const body = fn("crm_merge_clients");
    expect(body).toMatch(/pg_constraint/);
    expect(body).toMatch(/confrelid = 'public\.clients'::regclass/);
    expect(body).toMatch(/client_discounts_client_id_target_key/);
    expect(body).toMatch(/unhandled_unique/);
    expect(body).toMatch(/set_config\('crm\.client_merge', 'on', true\)/);
    expect(body).toMatch(/merged_into_client_id = p_target_client_id/);
    expect(body).toMatch(/clients_merged/);
  });

  it("requires workspace membership and non-empty name/sources", () => {
    const body = fn("crm_merge_clients");
    expect(body).toMatch(/crm_can_merge_clients/);
    expect(body).toMatch(/merge_clients:name_required/);
    expect(body).toMatch(/merge_clients:sources_required/);
    expect(body).toMatch(/for update/);
  });
});
