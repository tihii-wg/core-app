import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261105220000_reopen_cancelled_order.PRODUCTION.sql"),
  "utf8",
);

describe("reopen_cancelled_order SQL", () => {
  it("extends lifecycle tokens and guard for reopen clearing closed_at", () => {
    expect(sql).toMatch(/check \(op in \('close', 'cancel', 'replace', 'reopen'\)\)/);
    expect(sql).toMatch(/v_reopen_tok/);
    expect(sql).toMatch(/v_reopen_clearing/);
    expect(sql).toMatch(/cannot_clear_closed_at/);
    expect(sql).toMatch(/order_lifecycle_guard@v3/);
  });

  it("exposes owner_id-only reopen_cancelled_order that clears closed_at", () => {
    expect(sql).toMatch(/create or replace function public\.reopen_cancelled_order/);
    expect(sql).toMatch(/crm_is_workspace_owner_id\(p_workspace_id\)/);
    expect(sql).toMatch(/closed_at = null/);
    expect(sql).toMatch(/op = 'reopen'/);
    expect(sql).toMatch(/not_cancelled/);
    expect(sql).toMatch(/Independent of owner_can_manage_closed_orders|not manage-closed setting/);
    expect(sql).toMatch(/grant execute on function public\.reopen_cancelled_order\(uuid, uuid, text, uuid\) to authenticated/);
    expect(sql).toMatch(/revoke all on function public\.reopen_cancelled_order\(uuid, uuid, text, uuid\) from public, anon/);
  });

  it("does not delete history or rewrite warranty snapshots", () => {
    expect(sql).not.toMatch(/delete from public\.order_events/i);
    expect(sql).not.toMatch(/delete from public\.warranty_records/i);
    expect(sql).not.toMatch(/update public\.warranty_records/i);
    expect(sql).toMatch(/preserves history\/warranties|Preserve|history stays in order_events/i);
  });
});
