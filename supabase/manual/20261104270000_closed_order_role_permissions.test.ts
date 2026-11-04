import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "20261104270000_closed_order_role_permissions.PRODUCTION.sql",
);

describe("closed order role permissions SQL @v2", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("documents the MAIN root causes and uses workspaces.owner_id as owner authority", () => {
    expect(sql).toMatch(/cannot_cancel_closed/);
    expect(sql).toMatch(/crm_has_permission does NOT read workspaces\.owner_id/i);
    expect(sql).toMatch(/crm_is_workspace_owner_id/);
    expect(sql).toMatch(/w\.owner_id = auth\.uid\(\)/);
    expect(sql).toMatch(/workspaces\.owner_id missing/);
  });

  it("registers both permissions with owner_id bypass and default-deny grants", () => {
    expect(sql).toMatch(/orders\.cancel_closed/);
    expect(sql).toMatch(/orders\.delete_closed/);
    expect(sql).toMatch(/workspace_role_permission_grants/);
    expect(sql).toMatch(/crm_has_closed_order_permission/);
    expect(sql).toMatch(/check \(workspace_role in \('admin', 'manager', 'member'\)\)/);
    expect(sql).toMatch(/public\.is_workspace_member\(uuid\)/);
    expect(sql).not.toMatch(/crm_is_workspace_member/);
  });

  it("does not route closed-order checks through admin-default-all crm_has_permission alone", () => {
    const helper = sql.slice(sql.indexOf("create or replace function public.crm_has_closed_order_permission"));
    const helperOnly = helper.slice(0, helper.indexOf("create or replace function public.order_lifecycle_guard"));
    expect(helperOnly).not.toMatch(/crm_has_permission\(/);
    expect(helperOnly).toMatch(/crm_is_workspace_owner_id/);
    expect(helperOnly).toMatch(/workspace_role_permission_grants/);
  });

  it("removes hard cannot_cancel_closed and enforces cancel_closed / owner_id", () => {
    const cancel = sql.slice(sql.indexOf("create or replace function public.cancel_order"));
    const cancelOnly = cancel.slice(0, cancel.indexOf("create or replace function public.delete_order_with_payments"));
    expect(cancelOnly).toMatch(/orders\.cancel_closed/);
    expect(cancelOnly).toMatch(/forbidden_cancel_closed/);
    expect(cancelOnly).toMatch(/crm_is_workspace_owner_id|crm_has_closed_order_permission/);
    expect(cancelOnly).toMatch(/orders\.edit/);
    // Hard block must not remain as an unconditional raise in the function body.
    expect(cancelOnly).not.toMatch(/raise exception 'order_lifecycle:cannot_cancel_closed'/i);
  });

  it("requires cancelled-first deletion and uses delete_closed for closed orders", () => {
    const del = sql.slice(sql.indexOf("create or replace function public.delete_order_with_payments"));
    expect(del).toMatch(/orders\.delete_closed/);
    expect(del).toMatch(/forbidden_closed/);
    expect(del).toMatch(/orders\.delete/);
    expect(del).toMatch(/not_cancelled/);
    expect(del).toMatch(/crm_is_workspace_owner_id/);
    expect(del).toMatch(/has_invoice/);
    expect(del).toMatch(/has_active_payment|has_refund/);
    // Cancelled check must apply before/alongside closed permission (not skipped for closed).
    const cancelledIdx = del.search(/raise exception 'order_delete:not_cancelled'/i);
    const closedPermIdx = del.search(/orders\.delete_closed/i);
    expect(cancelledIdx).toBeGreaterThan(0);
    expect(closedPermIdx).toBeGreaterThan(cancelledIdx);
  });

  it("writes activity_log audit before deleting the order", () => {
    const del = sql.slice(sql.indexOf("create or replace function public.delete_order_with_payments"));
    const auditIdx = del.indexOf("activity_log");
    const deleteIdx = del.search(/delete from public\.orders/i);
    expect(auditIdx).toBeGreaterThan(0);
    expect(deleteIdx).toBeGreaterThan(auditIdx);
    expect(del).toMatch(/'order_deleted'/);
    expect(del).toMatch(/order_number/);
  });

  it("allows lifecycle guard cancel token on closed orders without clearing closed_at", () => {
    const guard = sql.slice(sql.indexOf("create or replace function public.order_lifecycle_guard"));
    const guardOnly = guard.slice(0, guard.indexOf("create or replace function public.cancel_order"));
    expect(guardOnly).toMatch(/v_cancel_tok/);
    expect(guardOnly).toMatch(/cannot_clear_closed_at/);
  });

  it("keeps grants write restricted via workspaces.owner_id RLS", () => {
    expect(sql).toMatch(/workspace_role_permission_grants_write_owner/);
    expect(sql).toMatch(/w\.owner_id = auth\.uid\(\)/);
    expect(sql).toMatch(/workspace_role_permission_grants_select_member/);
  });

  it("is transactional with preflight and post-apply asserts", () => {
    expect(sql.includes("\nbegin;") || sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql).toMatch(/commit;/);
    expect(sql).toMatch(/closed_order_permissions preflight failed/);
    expect(sql).toMatch(/closed_order_permissions post-apply failed/);
    expect(sql).toMatch(/closed_order_permissions @v2 OK/);
  });
});
