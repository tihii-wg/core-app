import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261115100000_workspace_session_idle_timeout.PRODUCTION.sql"),
  "utf8",
);

describe("workspace_session_idle_timeout SQL", () => {
  it("is a single DO block with preflight/postflight and schema reload", () => {
    expect(sql).toMatch(/do \$workspace_session_idle_timeout\$/);
    expect(sql).toMatch(/\$workspace_session_idle_timeout\$;/);
    expect(sql).toMatch(/workspace_session_idle_timeout preflight/);
    expect(sql).toMatch(/workspace_session_idle_timeout postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/create temp table/i);
  });

  it("adds nullable session_idle_timeout_minutes with allowed CHECK values", () => {
    expect(sql).toMatch(/add column session_idle_timeout_minutes integer null/);
    expect(sql).toMatch(
      /session_idle_timeout_minutes in \(30,\s*60,\s*120,\s*240,\s*480,\s*720,\s*1440\)/,
    );
    expect(sql).toMatch(/session_idle_timeout_minutes is null/);
    expect(sql).toMatch(/set default null/);
  });

  it("exposes owner/admin RPC and keeps table UPDATE owner-only for other columns", () => {
    expect(sql).toMatch(/crm_set_workspace_session_idle_timeout\(/);
    expect(sql).toMatch(/crm_is_workspace_owner_id\(p_workspace_id\)/);
    expect(sql).toMatch(/v_role is distinct from 'admin'/);
    expect(sql).toMatch(/grant execute on function public\.crm_set_workspace_session_idle_timeout/);
    expect(sql).not.toMatch(/drop policy "Allow update active workspace"/i);
  });
});
