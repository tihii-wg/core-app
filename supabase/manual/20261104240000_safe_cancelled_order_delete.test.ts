import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261104240000_safe_cancelled_order_delete.PRODUCTION.sql");

describe("safe cancelled order delete @v4 SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("replaces the function in place as @v4 with the same signature", () => {
    expect(sql).toMatch(/create or replace function public\.delete_order_with_payments\(\s*p_workspace_id uuid,\s*p_order_id uuid\s*\)/i);
    expect(sql).toMatch(/delete_order_with_payments@v4/);
    expect(sql).not.toMatch(/delete_order_with_payments@v3/);
  });

  it("labels blocking invoices with invoices.number and never references invoices.invoice_number in the function body", () => {
    const bodyMatch = sql.match(/as \$fn\$([\s\S]*?)\$fn\$;/i);
    expect(bodyMatch?.[1]).toBeTruthy();
    const body = bodyMatch![1];
    expect(body).toMatch(/trim\(i\.number\)/);
    expect(body).not.toMatch(/i\.invoice_number|\.invoice_number/);
    expect(body).toMatch(/order_delete:has_invoice:%/);
    expect(body).toMatch(/invoice_orders/);
  });

  it("keeps cancelled-only, payment, refund, and finance protections", () => {
    expect(sql).toMatch(/order_delete:not_cancelled/);
    expect(sql).toMatch(/order_delete:has_active_payment/);
    expect(sql).toMatch(/order_delete:has_refund/);
    expect(sql).toMatch(/order_delete:has_finance_transactions/);
    expect(sql).toMatch(/semantic_action = 'cancel'/);
  });

  it("preflights the real invoice schema columns before install", () => {
    expect(sql).toMatch(/attname = 'number'/);
    expect(sql).toMatch(/attname = 'order_id'/);
    expect(sql).toMatch(/attname = 'workspace_id'/);
  });
});
