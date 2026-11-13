import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261114200000_closed_order_full_access.PRODUCTION.sql"),
  "utf8",
);

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
    // Only reopen_cancelled_order's dynamic UPDATE of a single cancelled row — no bulk data migrations.
    expect(sql).not.toMatch(/^\s*update public\.(orders|payments|workspaces)\b/im);
    expect(sql).not.toMatch(/\bdelete from public\.(orders|payments)\b/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });

  it("documents invoice/warranty delete protections stay via existing helpers", () => {
    // Script does not rewrite delete_order_with_payments — it relies on crm_has_closed_order_permission.
    expect(sql).not.toMatch(/create or replace function public\.delete_order_with_payments/);
    expect(sql).toMatch(/crm_has_closed_order_permission@v4|crm_has_closed_order_permission/);
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
