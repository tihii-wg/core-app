import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "20261105200000_crm_recent_active_order_ids.PRODUCTION.sql"), "utf8");

describe("crm_recent_active_order_ids SQL", () => {
  it("defines a workspace-scoped distinct recent-order RPC with preflight and postflight", () => {
    expect(sql).toMatch(/create or replace function public\.crm_recent_active_order_ids/);
    expect(sql).toMatch(/p_workspace_id uuid/);
    expect(sql).toMatch(/group by e\.order_id/);
    expect(sql).toMatch(/order by last_activity_at desc/);
    expect(sql).toMatch(/payment_recorded/);
    expect(sql).toMatch(/status_changed/);
    expect(sql).toMatch(/preflight/);
    expect(sql).toMatch(/postflight/);
    expect(sql).not.toMatch(/truncate\s+public\.order_events/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.order_events/i);
  });
});
