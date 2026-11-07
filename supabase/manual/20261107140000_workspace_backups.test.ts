import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(dir, "20261107140000_workspace_backups.PRODUCTION.sql"), "utf8");
const cron = readFileSync(join(dir, "20261107140100_workspace_backups_scheduler.PRODUCTION.sql"), "utf8");

describe("workspace_backups SQL", () => {
  it("creates owner-only settings and run history with RLS", () => {
    expect(sql).toMatch(/create table if not exists public\.workspace_backup_settings/);
    expect(sql).toMatch(/provider text check \(provider in \('github', 'google_drive'\)\)/);
    expect(sql).toMatch(/alter table public\.workspace_backup_settings enable row level security/);
    expect(sql).toMatch(/public\.crm_is_workspace_owner_id\(workspace_id\)/);
  });
  it("keeps credentials in Vault and never grants the secret id to authenticated", () => {
    expect(sql).toMatch(/vault\.create_secret/);
    expect(sql).toMatch(/revoke all on function public\.crm_backup_get_credential\(uuid\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant select \([^)]*credential_secret_id/);
  });
  it("exports only one workspace and skips secret-bearing tables", () => {
    expect(sql).toMatch(/where workspace_id = \$1/);
    expect(sql).toMatch(/where p\.workspace_id = \$1/);
    expect(sql).toMatch(/'api_keys', 'webhook_endpoints'/);
    expect(sql).toMatch(/grant execute on function public\.crm_backup_export_rows\(uuid, text, integer, integer\) to service_role/);
  });
  it("schedules the hourly job via pg_net with a Vault token", () => {
    expect(cron).toMatch(/cron\.schedule\(\s*'workspace-backups-hourly'/);
    expect(cron).toMatch(/x-backup-cron-token/);
    expect(cron).toMatch(/vault\.decrypted_secrets where name = 'backup_function_url'/);
  });
});
