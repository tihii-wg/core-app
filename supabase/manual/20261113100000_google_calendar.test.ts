import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261113100000_google_calendar.PRODUCTION.sql"),
  "utf8",
);

describe("google_calendar SQL", () => {
  it("is a single DO block with loud preflight/postflight and schema reload", () => {
    expect(sql).toMatch(/do \$google_calendar\$/);
    expect(sql).toMatch(/\$google_calendar\$;/);
    expect(sql).toMatch(/google_calendar preflight/);
    expect(sql).toMatch(/google_calendar postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });

  it("creates workspace_google_calendar with member SELECT and no secrets", () => {
    expect(sql).toMatch(/create table if not exists public\.workspace_google_calendar/);
    expect(sql).toMatch(/google_email text/);
    expect(sql).toMatch(/calendar_id text/);
    expect(sql).toMatch(/calendar_summary text/);
    expect(sql).toMatch(/calendar_time_zone text/);
    expect(sql).toMatch(/workspace_google_calendar_member_select/);
    expect(sql).toMatch(/grant select on table public\.workspace_google_calendar to authenticated/);
    expect(sql).not.toMatch(/refresh_token/);
  });

  it("mirrors gdrive vault RPCs for service_role only", () => {
    expect(sql).toMatch(/create table if not exists public\.workspace_google_calendar_secrets/);
    expect(sql).toMatch(/crm_gcal_set_credential\(p_workspace_id uuid, p_secret text\)/);
    expect(sql).toMatch(/crm_gcal_get_credential\(p_workspace_id uuid\)/);
    expect(sql).toMatch(/crm_gcal_clear_credential\(p_workspace_id uuid\)/);
    expect(sql).toMatch(/grant execute on function public\.crm_gcal_set_credential\(uuid, text\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.crm_gcal_get_credential\(uuid\) from public, anon, authenticated/);
  });
});
