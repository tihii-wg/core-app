import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112160000_order_service_line_edit.PRODUCTION.sql"),
  "utf8",
);

describe("order_service_line_edit SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/order_service_line_edit preflight failed/);
    expect(sql).toMatch(/order_service_line_edit postflight failed/);
  });

  it("drops the old 6-arg overload and creates the extended signature", () => {
    expect(sql).toMatch(
      /drop function if exists public\.crm_update_order_service_line\(uuid, uuid, numeric, numeric, uuid, boolean\)/,
    );
    expect(sql).toMatch(/p_set_warranty boolean default false/);
    expect(sql).toMatch(/p_set_kind boolean default false/);
    expect(sql).toMatch(/p_set_discount boolean default false/);
    expect(sql).toMatch(/p_warranty_months/);
    expect(sql).toMatch(/p_warranty_days/);
    expect(sql).toMatch(/p_warranty_km/);
    expect(sql).toMatch(/p_kind/);
    expect(sql).toMatch(/p_discount_type/);
    expect(sql).toMatch(/p_discount_value/);
  });

  it("keeps closed/cancelled locks, recalc, and full-order return", () => {
    expect(sql).toMatch(/closed_order_immutable/);
    expect(sql).toMatch(/cancelled_order_immutable/);
    expect(sql).toMatch(/crm_recalc_order_line_totals/);
    expect(sql).toMatch(/return public\.crm_get_order_full\(p_order_id\)/);
    expect(sql).toMatch(/crm_assert_order_line_edit/);
  });

  it("documents clear semantics via p_set_* flags writing NULL", () => {
    expect(sql).toMatch(/p_set_warranty = true/);
    expect(sql).toMatch(/NULL clears/);
    expect(sql).toMatch(/set warranty_months = \$2, warranty_days = \$3, warranty_km = \$4/);
  });
});
