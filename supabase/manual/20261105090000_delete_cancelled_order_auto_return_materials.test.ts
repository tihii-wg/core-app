import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "20261105090000_delete_cancelled_order_auto_return_materials.PRODUCTION.sql",
);

describe("delete cancelled order auto-return materials SQL @v7", () => {
  const sql = readFileSync(sqlPath, "utf8");
  const bodyMatch = sql.match(
    /create or replace function public\.delete_order_with_payments\([\s\S]*?as \$fn\$([\s\S]*?)\$fn\$;/i,
  );
  const body = bodyMatch?.[1] ?? "";

  it("replaces delete_order_with_payments @v7 and keeps the same signature", () => {
    expect(sql).toMatch(
      /create or replace function public\.delete_order_with_payments\(\s*p_workspace_id uuid,\s*p_order_id uuid\s*\)/i,
    );
    expect(sql).toMatch(/delete_order_with_payments@v7/);
  });

  it("documents why manual return previously unblocked deletion", () => {
    expect(sql).toMatch(/issued_materials_on_closed_order/);
    expect(sql).toMatch(/manual UI return/i);
  });

  it("never raises issued_materials_on_closed_order inside the function body", () => {
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/raise exception 'order_delete:issued_materials_on_closed_order'/i);
  });

  it("requires cancelled-first and reuses return_order_materials_to_warehouse", () => {
    expect(body).toMatch(/order_delete:not_cancelled/);
    expect(body).toMatch(/return_order_materials_to_warehouse/);
    expect(body).toMatch(/quantity_issued/);
    expect(body).toMatch(/quantity_returned/);
    expect(body).toMatch(/movement_type in \('issue', 'return'\)/);
  });

  it("returns only ledger-positive outstanding qty per warehouse with idempotent keys", () => {
    expect(body).toMatch(/having sum\(case when m\.movement_type = 'issue' then m\.quantity else -m\.quantity end\) > 0/);
    expect(body).toMatch(/order_delete:' \|\| p_order_id::text/);
    expect(body).toMatch(/materials_outstanding_after_return/);
    expect(body).toMatch(/for update of om/);
  });

  it("preserves financial and audit safeguards", () => {
    expect(body).toMatch(/order_delete:has_invoice/);
    expect(body).toMatch(/order_delete:has_active_payment/);
    expect(body).toMatch(/order_delete:has_refund/);
    expect(body).toMatch(/'order_deleted'/);
    // activity_log insert must precede delete from orders
    const auditIdx = body.indexOf("activity_log");
    const deleteIdx = body.search(/delete from public\.orders/i);
    expect(auditIdx).toBeGreaterThan(0);
    expect(deleteIdx).toBeGreaterThan(auditIdx);
  });

  it("keeps closed vs open delete permission split with owner_id authority", () => {
    expect(body).toMatch(/orders\.delete_closed/);
    expect(body).toMatch(/orders\.delete/);
    expect(body).toMatch(/crm_is_workspace_owner_id|crm_has_closed_order_permission/);
  });

  it("is transactional with preflight and post-apply asserts", () => {
    expect(sql).toMatch(/\nbegin;/);
    expect(sql).toMatch(/commit;/);
    expect(sql).toMatch(/delete_cancelled_auto_return preflight failed/);
    expect(sql).toMatch(/delete_cancelled_auto_return post-apply failed/);
    expect(sql).toMatch(/still raises issued_materials_on_closed_order/);
  });
});
