import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106100000_remove_warranty_with_deleted_line.PRODUCTION.sql"),
  "utf8",
);

describe("remove_warranty_with_deleted_line SQL", () => {
  it("deletes only the deleted line's warranty, gated by the owner helper", () => {
    expect(sql).toMatch(/crm_owner_may_unlink_order_warranty\(old\.order_id\)/);
    expect(sql).toMatch(/wr\.order_service_id = old\.id/);
    expect(sql).toMatch(/wr\.order_material_id = old\.id/);
    expect(sql).toMatch(/wr\.workspace_id = v_ws/);
  });

  it("installs BEFORE DELETE triggers on both line tables after the closed guards", () => {
    expect(sql).toMatch(/create trigger trg_order_services_remove_warranty_bd\s+before delete on public\.order_services/);
    expect(sql).toMatch(/create trigger trg_order_materials_remove_warranty_bd\s+before delete on public\.order_materials/);
  });

  it("refuses when a warranty claim references the record and keeps the snapshot trigger", () => {
    expect(sql).toMatch(/warranty_records:has_claims/);
    expect(sql).toMatch(/warranty_order_claims/);
    expect(sql).not.toMatch(/drop trigger if exists trg_warranty_records_snapshot_immutable/);
    expect(sql).not.toMatch(/disable trigger/i);
  });

  it("cleans up only orphaned rows on cancelled or reopened orders", () => {
    expect(sql).toMatch(/wr\.order_service_id is null\s+and wr\.order_material_id is null/);
    expect(sql).toMatch(/o\.status = 'cancelled' or o\.closed_at is null/);
  });
});
