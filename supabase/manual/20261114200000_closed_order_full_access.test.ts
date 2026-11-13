import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261114200000_closed_order_full_access.PRODUCTION.sql"),
  "utf8",
);

/** SQL outside function bodies — bulk data statements must never appear there. */
const topLevelSql = sql.replace(/as \$fn\$[\s\S]*?\$fn\$;/g, "");

const fn = (name: string) => {
  const needle = `create or replace function public.${name}(`;
  const i = sql.lastIndexOf(needle);
  expect(i).toBeGreaterThan(-1);
  const end = sql.indexOf("$fn$;", i);
  expect(end).toBeGreaterThan(i);
  return sql.slice(i, end + 5);
};

describe("closed_order_full_access SQL", () => {
  it("adds orders.closed_full_access to the grants CHECK constraint", () => {
    expect(sql).toMatch(/orders\.closed_full_access/);
    expect(sql).toMatch(/workspace_role_permission_grants_permission_check/);
    expect(sql).toMatch(/'orders\.cancel_closed'/);
    expect(sql).toMatch(/'orders\.delete_closed'/);
  });

  it("defines crm_acts_as_owner_for_closed_orders for owner_id or full-access role", () => {
    const body = fn("crm_acts_as_owner_for_closed_orders");
    expect(body).toMatch(/crm_is_workspace_owner_id/);
    expect(body).toMatch(/orders\.closed_full_access/);
    expect(body).toMatch(/'admin', 'manager', 'member'/);
    expect(body).not.toMatch(/owner_can_manage_closed_orders/);
  });

  it("extends cancel/delete helper: owner+toggle, full access, or specific grants", () => {
    const body = fn("crm_has_closed_order_permission");
    expect(body).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(body).toMatch(/orders\.closed_full_access/);
    expect(body).toMatch(/owner_can_manage_closed_orders/);
    expect(body).toMatch(/'orders\.cancel_closed', 'orders\.delete_closed'/);
  });

  it("lets full-access roles edit cancelled and reopen; closed non-cancelled stay immutable", () => {
    expect(fn("crm_owner_may_edit_cancelled_order")).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(fn("crm_owner_may_edit_cancelled_order")).toMatch(/cancelled/);
    expect(fn("crm_owner_may_unlink_order_warranty")).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(fn("reopen_cancelled_order")).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders must remain always-false/);
    expect(sql).toMatch(/select false/);
  });

  it("is idempotent and does not mass-update order data", () => {
    expect(sql).toMatch(/create or replace function public\.crm_acts_as_owner_for_closed_orders/);
    expect(sql).toMatch(/drop constraint if exists workspace_role_permission_grants_permission_check/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    // Row-level UPDATE/DELETE live only inside function bodies — no bulk data migrations at top level.
    expect(topLevelSql).not.toMatch(/^\s*update public\.(orders|payments|workspaces)\b/im);
    expect(topLevelSql).not.toMatch(/\bdelete from public\.(orders|payments)\b/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });

  it("delete keeps invoice/warranty/payment/stock protections; only the non-closed cancelled branch uses acts-as-owner", () => {
    const del = fn("delete_order_with_payments");
    expect(del).toMatch(/crm_has_closed_order_permission\(p_workspace_id, 'orders\.delete_closed'\)/);
    expect(del).toMatch(/crm_acts_as_owner_for_closed_orders\(p_workspace_id\)/);
    expect(del).toMatch(/crm_has_permission\(p_workspace_id, 'orders\.delete'\)/);
    expect(del).not.toMatch(/crm_is_workspace_owner_id/);
    for (const code of [
      "order_delete:not_cancelled",
      "order_delete:has_invoice",
      "order_delete:has_warranty_orders",
      "order_delete:has_warranty_claims",
      "order_delete:has_active_payment",
    ]) {
      expect(del).toContain(code);
    }
  });

  it("custom status on cancelled orders and payment void accept full-access roles", () => {
    const status = fn("set_order_lifecycle_regular_custom_status");
    expect(status).toMatch(/crm_acts_as_owner_for_closed_orders\(p_workspace_id\)/);
    expect(status).toMatch(/crm_owner_may_manage_closed_orders/);
    expect(status).not.toMatch(/crm_is_workspace_owner_id/);

    const voidFn = fn("crm_cancel_order_with_payment_void");
    expect(voidFn).toMatch(/crm_acts_as_owner_for_closed_orders\(p_workspace_id\)/);
    expect(voidFn).toMatch(/crm_has_permission\(p_workspace_id, 'orders\.edit'\)/);
    expect(voidFn).not.toMatch(/crm_is_workspace_owner_id/);
  });

  it("covers owner vs role full-access paths for cancel/delete/edit/reopen/unlink", () => {
    const hasPerm = fn("crm_has_closed_order_permission");
    // Owner still gated by owner_can_manage_closed_orders.
    expect(hasPerm).toMatch(/owner_can_manage_closed_orders/);
    expect(hasPerm).toMatch(/w\.owner_id = auth\.uid\(\)/);
    // Full-access role path independent of that toggle.
    expect(hasPerm).toMatch(/orders\.closed_full_access/);
    expect(hasPerm).toMatch(/wm\.role in \('admin', 'manager', 'member'\)/);

    const edit = fn("crm_owner_may_edit_cancelled_order");
    expect(edit).toMatch(/v_status is distinct from 'cancelled'/);
    expect(edit).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(edit).not.toMatch(/owner_can_manage_closed_orders/);

    const unlink = fn("crm_owner_may_unlink_order_warranty");
    expect(unlink).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(unlink).toMatch(/crm_owner_may_manage_closed_orders/);

    const reopen = fn("reopen_cancelled_order");
    expect(reopen).toMatch(/crm_acts_as_owner_for_closed_orders/);
    expect(reopen).toMatch(/order_lifecycle:forbidden/);
    expect(reopen).toMatch(/status is distinct from 'cancelled'|status = ''cancelled''/);
  });
});
