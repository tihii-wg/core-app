import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261104250000_order_warranty_workflow.PRODUCTION.sql");

describe("order warranty workflow SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("creates warranty snapshot and claim tables with workspace scope", () => {
    expect(sql).toMatch(/create table if not exists public\.warranty_records/i);
    expect(sql).toMatch(/create table if not exists public\.warranty_order_claims/i);
    expect(sql).toMatch(/warranty_source_order_id/);
    expect(sql).toMatch(/warranty_service_months/);
    expect(sql).toMatch(/warranty_months/);
  });

  it("activates warranties from close_order_if_settled and never from create alone", () => {
    expect(sql).toMatch(/activate_order_warranties/);
    expect(sql).toMatch(/close_order_if_settled/);
    expect(sql).toMatch(/warranties_activated/);
  });

  it("blocks deleting originals that still have warranty claim orders", () => {
    expect(sql).toMatch(/order_delete_blocked_by_warranty/);
    expect(sql).toMatch(/has_warranty_orders/);
  });
});
