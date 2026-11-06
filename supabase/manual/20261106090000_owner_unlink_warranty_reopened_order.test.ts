import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106090000_owner_unlink_warranty_reopened_order.PRODUCTION.sql"),
  "utf8",
);

describe("owner_unlink_warranty_reopened_order SQL", () => {
  it("adds an owner_id-only helper covering cancelled, reopened and manage-closed orders", () => {
    expect(sql).toMatch(/create or replace function public\.crm_owner_may_unlink_order_warranty/);
    expect(sql).toMatch(/crm_is_workspace_owner_id\(v_ws\)/);
    expect(sql).toMatch(/v_status is not distinct from 'cancelled'/);
    expect(sql).toMatch(/v_closed_at is null/);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders\(v_ws\)/);
    expect(sql).toMatch(/revoke all on function public\.crm_owner_may_unlink_order_warranty\(uuid\) from public, anon/);
  });

  it("keeps snapshot terms immutable and only relaxes the SET NULL unlink", () => {
    expect(sql).toMatch(/warranty_records_reject_snapshot_mutation@v3/);
    expect(sql).toMatch(/crm_owner_may_unlink_order_warranty\(old\.order_id\)/);
    expect(sql).toMatch(/v_terms_changed or v_service_relink or v_material_relink/);
    expect(sql).toMatch(/warranty_records:snapshot_immutable/);
  });

  it("never deletes history or disables the trigger", () => {
    expect(sql).not.toMatch(/delete from public\.warranty_records/i);
    expect(sql).not.toMatch(/disable trigger/i);
    expect(sql).not.toMatch(/activated_on_close\s*=\s*false/i);
    expect(sql).toMatch(/create trigger trg_warranty_records_snapshot_immutable/);
  });
});
