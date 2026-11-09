import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261109090000_order_photos_google_drive.PRODUCTION.sql"),
  "utf8",
);

describe("order_photos_google_drive SQL", () => {
  it("adds the workspace storage mode with an owner-only switch", () => {
    expect(sql).toMatch(/add column if not exists attachment_storage text not null default 'app'/);
    expect(sql).toMatch(/create or replace function public\.crm_set_attachment_storage/);
    expect(sql).toMatch(/attachment_storage:owner_only/);
    expect(sql).toMatch(/attachment_storage:google_drive_not_connected/);
  });

  it("keeps the refresh token in Vault behind a service_role-only table", () => {
    expect(sql).toMatch(/create table if not exists public\.workspace_google_drive_secrets/);
    expect(sql).toMatch(/revoke all on table public\.workspace_google_drive_secrets from public, anon, authenticated;/);
    expect(sql).toMatch(/vault\.create_secret/);
    expect(sql).toMatch(/grant execute on function public\.crm_gdrive_get_credential\(uuid\) to service_role;/);
  });

  it("links Drive files to order attachments and lets only the server create them", () => {
    expect(sql).toMatch(/add column if not exists drive_file_id text/);
    expect(sql).toMatch(/storage_provider = 'google_drive' and drive_file_id is not null/);
    expect(sql).toMatch(/order_attachments:drive_rows_server_only/);
  });

  it("is transactional and does not change existing attachments", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).not.toMatch(/update public\.order_attachments/i);
    expect(sql).not.toMatch(/delete from public\.order_attachments/i);
  });
});
