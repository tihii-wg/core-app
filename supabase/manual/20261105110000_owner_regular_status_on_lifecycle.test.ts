import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "20261105110000_owner_regular_status_on_lifecycle.PRODUCTION.sql",
);

describe("owner regular status on lifecycle SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("exposes set_order_lifecycle_regular_custom_status gated by crm_is_workspace_owner_id", () => {
    expect(sql).toMatch(/create or replace function public\.set_order_lifecycle_regular_custom_status/i);
    expect(sql).toMatch(/crm_is_workspace_owner_id\(p_workspace_id\)/);
    expect(sql).not.toMatch(/workspace_members\.role\s*=\s*'owner'/);
  });

  it("updates custom_status_id only and never clears closed_at", () => {
    expect(sql).toMatch(/set custom_status_id = p_custom_status_id/i);
    expect(sql).toMatch(/o\.closed_at is not distinct from v_order\.closed_at/);
    expect(sql).toMatch(/o\.status is not distinct from v_order\.status/);
    expect(sql).not.toMatch(/closed_at\s*=\s*null/i);
    expect(sql).not.toMatch(/activate_order_warranties/i);
  });

  it("rejects close/cancel semantic and closed/cancelled system targets", () => {
    expect(sql).toMatch(/semantic_action is distinct from 'normal'/);
    expect(sql).toMatch(/system_status in \('closed', 'cancelled'\)/);
  });

  it("uses replace token when closed_at is set", () => {
    expect(sql).toMatch(/'replace'/);
    expect(sql).toMatch(/order_lifecycle_tokens/);
    expect(sql).toMatch(/v_need_replace_token := v_order\.closed_at is not null/);
  });

  it("grants execute to authenticated only (not anon)", () => {
    expect(sql).toMatch(/grant execute on function public\.set_order_lifecycle_regular_custom_status\(uuid, uuid, uuid\) to authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.set_order_lifecycle_regular_custom_status\(uuid, uuid, uuid\) from public, anon/i);
  });
});
