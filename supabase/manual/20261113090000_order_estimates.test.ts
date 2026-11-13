import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261113090000_order_estimates.PRODUCTION.sql"),
  "utf8",
);

describe("order_estimates SQL", () => {
  it("is a single DO block with loud preflight/postflight and schema reload", () => {
    expect(sql).toMatch(/do \$order_estimates\$/);
    expect(sql).toMatch(/\$order_estimates\$;/);
    expect(sql).toMatch(/order_estimates preflight/);
    expect(sql).toMatch(/order_estimates postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/create temp table/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });

  it("adds orders.kind with estimate/order check and estimate columns with defaults", () => {
    expect(sql).toMatch(/add column if not exists kind text not null default 'order'/);
    expect(sql).toMatch(/kind in \('order', 'estimate'\)/);
    expect(sql).toMatch(/add column if not exists estimate_status_id uuid/);
    expect(sql).toMatch(/add column if not exists estimate_accepted_at timestamptz/);
    expect(sql).toMatch(/orders_workspace_kind_idx/);
    // Columns ship WITH defaults — no workspace-wide kind backfill (convert RPC may update one locked row).
    expect(sql).not.toMatch(/update public\.orders[\s\S]{0,200}where\s+kind\s+is\s+null/i);
    expect(sql).not.toMatch(/update public\.orders[\s\S]{0,200}where\s+workspace_id\s+is\s+not\s+null/i);
  });

  it("extends semantic_action with accept for estimate entity only", () => {
    expect(sql).toMatch(/semantic_action in \('normal', 'close', 'cancel', 'accept'\)/);
    expect(sql).toMatch(/status_definitions_accept_estimate_only/);
    expect(sql).toMatch(/semantic_action is distinct from 'accept' or entity = 'estimate'/);
  });

  it("seeds estimate statuses and exposes convert / set-status RPCs", () => {
    expect(sql).toMatch(/entity = 'estimate'/);
    expect(sql).toMatch(/crm_convert_estimate_to_order\(p_order_id uuid\)/);
    expect(sql).toMatch(/crm_set_estimate_status\(p_order_id uuid, p_status_id uuid\)/);
    expect(sql).toMatch(/estimate_converted/);
    expect(sql).toMatch(/estimate_status_changed/);
    expect(sql).toMatch(/grant execute on function public\.crm_convert_estimate_to_order/);
  });

  it("guards stock movement and payments for estimates", () => {
    expect(sql).toMatch(/crm_assert_order_allows_stock/);
    expect(sql).toMatch(/estimate:no_stock_movement/);
    expect(sql).toMatch(/estimate_no_stock_v1/);
    expect(sql).toMatch(/issue_order_materials_from_warehouse/);
    expect(sql).toMatch(/crm_payments_reject_estimate/);
    // Seeded statuses use allowed status groups (no 'open').
    expect(sql).not.toMatch(/'open',\s*\n\s*null,/);
    expect(sql).toMatch(/when 'accept' then 'done'/);
    // Decimal quantities are issued with 2 decimals on accept.
    expect(sql).toMatch(/trunc\(v_qty, 2\)/);
    // Estimate qty edits take the no-stock branch instead of being blocked.
    expect(sql).toMatch(/estimate_qty_no_stock_v1/);
    // Existing (imported) estimate statuses get an accept / cancel semantic when none is marked.
    expect(sql).toMatch(/set semantic_action = 'accept'/);
    expect(sql).toMatch(/status_group in \('dropped_off', 'canceled'\)/);
    // One cancel status per workspace/entity (unique index) — never mark several.
    expect(sql).toMatch(/status_definitions_one_cancel_uidx/);
    expect(sql).toMatch(/estimate:no_payments/);
    // Estimates are deletable in any status (no cancel-first step).
    expect(sql).toMatch(/estimate_delete_any_v1/);
  });
});
