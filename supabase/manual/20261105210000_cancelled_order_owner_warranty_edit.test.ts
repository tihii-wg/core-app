import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261105210000_cancelled_order_owner_warranty_edit.PRODUCTION.sql"),
  "utf8",
);

describe("cancelled_order_owner_warranty_edit SQL", () => {
  it("adds a cancelled+owner_id helper independent of owner_can_manage_closed_orders", () => {
    expect(sql).toMatch(/create or replace function public\.crm_owner_may_edit_cancelled_order/);
    expect(sql).toMatch(/crm_is_workspace_owner_id/);
    expect(sql).toMatch(/v_status is distinct from 'cancelled'/);
    expect(sql).toMatch(/Independent of owner_can_manage_closed_orders/);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders was removed/);
  });

  it("allows SET NULL unlink of line FKs without rewriting snapshot terms", () => {
    expect(sql).toMatch(/warranty_records_reject_snapshot_mutation/);
    expect(sql).toMatch(/v_service_unlink/);
    expect(sql).toMatch(/v_material_unlink/);
    expect(sql).toMatch(/crm_owner_may_edit_cancelled_order\(old\.order_id\)/);
    expect(sql).toMatch(/warranty_records:snapshot_immutable/);
    expect(sql).not.toMatch(/drop table public\.warranty_records/i);
    expect(sql).not.toMatch(/activated_on_close\s*=\s*false/i);
  });

  it("extends materials/services closed guards and apply_order_material_warranties", () => {
    expect(sql).toMatch(/order_materials_closed_guard@v2/);
    expect(sql).toMatch(/order_services_closed_guard@v2/);
    expect(sql).toMatch(/apply_order_material_warranties@v3/);
    expect(sql).toMatch(/orders_closed_content_guard@v2/);
  });

  it("keeps historical warranty rows and does not invent void columns", () => {
    expect(sql).not.toMatch(/alter table public\.warranty_records add/i);
    expect(sql).not.toMatch(/delete from public\.warranty_records/i);
    expect(sql).toMatch(/Preserve the historical row/);
  });
});
