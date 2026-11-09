import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261109100000_order_photos_nas.PRODUCTION.sql"),
  "utf8",
);

describe("order_photos_nas SQL", () => {
  it("adds the nas storage mode with WebDAV / S3 connection settings over HTTPS", () => {
    expect(sql).toMatch(/check \(attachment_storage in \('app', 'google_drive', 'nas'\)\)/);
    expect(sql).toMatch(/protocol in \('webdav', 's3'\)/);
    expect(sql).toMatch(/base_url ~\* '\^https:\/\/'/);
  });

  it("keeps the NAS password / secret key in Vault, service_role only", () => {
    expect(sql).toMatch(/revoke all on table public\.workspace_nas_storage_secrets from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.crm_nas_get_credential\(uuid\) to service_role;/);
  });

  it("links NAS files to order attachments, server-only", () => {
    expect(sql).toMatch(/add column if not exists nas_path text/);
    expect(sql).toMatch(/storage_provider = 'nas' and nas_path is not null/);
    expect(sql).toMatch(/order_attachments:remote_rows_server_only/);
  });

  it("is transactional and changes no attachment data", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).not.toMatch(/update public\.order_attachments|delete from public\.order_attachments/i);
  });
});
