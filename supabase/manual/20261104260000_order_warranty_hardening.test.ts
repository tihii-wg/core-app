import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261104260000_order_warranty_hardening.PRODUCTION.sql");

describe("order warranty hardening SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("adds duration_days and never converts warranty_days / 30 to months", () => {
    expect(sql).toMatch(/duration_days/);
    expect(sql).not.toMatch(/greatest\s*\(\s*1\s*,\s*\(.*warranty_days.*\/\s*30/i);
    expect(sql).toMatch(/make_interval\s*\(\s*days\s*=>/i);
  });

  it("captures immutable mileage on close and stops live vehicle fallback in activate", () => {
    expect(sql).toMatch(/vehicle_mileage_snapshot = coalesce\(o\.vehicle_mileage_snapshot/i);
    const activateBody = sql.slice(sql.indexOf("create or replace function public.activate_order_warranties"));
    const activateOnly = activateBody.slice(0, activateBody.indexOf("create or replace function public.close_order_if_settled"));
    expect(activateOnly).not.toMatch(/from public\.vehicles/i);
    expect(activateOnly).toMatch(/vehicle_mileage_snapshot/);
  });

  it("splits FOR ALL editor RLS into insert/update/delete", () => {
    expect(sql).toMatch(/drop policy if exists warranty_records_write_editor/i);
    expect(sql).toMatch(/warranty_records_insert_editor/);
    expect(sql).toMatch(/warranty_records_update_editor/);
    expect(sql).toMatch(/warranty_records_delete_editor/);
    expect(sql).toMatch(/orders\.delete/);
    expect(sql).toMatch(/drop policy if exists warranty_order_claims_write_editor/i);
  });

  it("requires orders.delete for warranty_order_claims hard DELETE and soft-deactivates via is_active", () => {
    expect(sql).toMatch(/add column if not exists is_active boolean not null default true/i);
    const deletePolicy = sql.match(
      /create policy warranty_order_claims_delete_editor[\s\S]*?using \(([^;]+)\);/i,
    );
    expect(deletePolicy?.[1] ?? "").toMatch(/orders\.delete/);
    expect(deletePolicy?.[1] ?? "").not.toMatch(/orders\.edit/);
  });

  it("uses public.is_workspace_member(uuid) in preflight and SELECT policies", () => {
    expect(sql).toMatch(/to_regprocedure\('public\.is_workspace_member\(uuid\)'\)/);
    expect(sql).toMatch(/using \(public\.is_workspace_member\(workspace_id\)\)/);
    expect(sql).not.toMatch(/to_regprocedure\('public\.crm_is_workspace_member/);
    expect(sql).not.toMatch(/public\.crm_is_workspace_member\(/);
  });

  it("guards original-order delete and freezes activated snapshots", () => {
    expect(sql).toMatch(/trg_orders_block_delete_with_warranty/);
    expect(sql).toMatch(/order_delete_blocked_by_warranty/);
    expect(sql).toMatch(/trg_warranty_records_snapshot_immutable/);
    expect(sql).toMatch(/warranty_records:snapshot_immutable/);
  });

  it("provides apply_order_material_warranties for material warranty persistence", () => {
    expect(sql).toMatch(/apply_order_material_warranties/);
    expect(sql).toMatch(/warranty_months/);
    expect(sql).toMatch(/warranty_days/);
    expect(sql).toMatch(/warranty_km/);
  });

  it("forces warranty_source_order_id ON DELETE RESTRICT", () => {
    expect(sql).toMatch(/on delete restrict/i);
    expect(sql).toMatch(/orders_warranty_source_order_id_fkey/);
  });
});
