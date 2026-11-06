import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106150000_supplier_return_refund.PRODUCTION.sql"),
  "utf8",
);

describe("supplier_return_refund SQL", () => {
  it("records one income transaction per posted return", () => {
    expect(sql).toMatch(/create or replace function public\.crm_record_supplier_return_refund/);
    expect(sql).toMatch(/supplier_return_refund:not_posted/);
    expect(sql).toMatch(/supplier_return_refund:already_refunded/);
    expect(sql).toMatch(/'income', v_account\.id/);
  });

  it("validates permission, account and amount", () => {
    expect(sql).toMatch(/finance\.transactions\.income/);
    expect(sql).toMatch(/supplier_return_refund:account_no_income/);
    expect(sql).toMatch(/supplier_return_refund:amount_exceeds_total/);
    expect(sql).toMatch(/supplier_return_refund:currency_mismatch/);
  });

  it("offers post + refund in one call", () => {
    expect(sql).toMatch(/create or replace function public\.crm_post_supplier_return_with_refund/);
    expect(sql).toMatch(/v_post := public\.crm_post_supplier_return\(p_return_id\)/);
  });

  it("does not touch payments or orders", () => {
    expect(sql).not.toMatch(/public\.payments/);
    expect(sql).not.toMatch(/public\.orders/);
  });
});
