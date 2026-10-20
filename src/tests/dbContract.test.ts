import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frontend <-> database contract (static, no remote access).
 *
 * The current frontend writes workspace/client columns and calls RPCs
 * that only exist once the General Settings manual SQL is applied.
 * Deploying the frontend without that SQL breaks client create/edit
 * and every settings save. This test pins the contract: every column
 * or function the frontend depends on must be provided by either the
 * committed migrations (already in Production) or the manual General
 * Settings PRODUCTION script (to be run at launch). If someone adds a
 * frontend write without the corresponding SQL, this test fails.
 */

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const migrationsSql = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => read(join("supabase/migrations", name)))
  .join("\n");

const generalSettingsSql = read(
  "supabase/manual/20261019220000_general_settings.PRODUCTION.sql",
);

const providedSql = `${migrationsSql}\n${generalSettingsSql}`;

// Columns the frontend writes in apiWorkspaces.updateWorkspaceDetails /
// updateWorkspacePreferences / updateWorkspace{Order,Contact,Invoice}Settings.
const workspaceColumns = [
  "company_address",
  "billing_email",
  "registration_number",
  "tax_vat_number",
  "iban",
  "bank_name",
  "bank_code",
  "company_description",
  "print_extra_info",
  "country_code",
  "document_language",
  "warranty_start",
  "default_comments_visibility",
  "default_files_visibility",
  "prevent_duplicate_device_orders",
  "show_client_middle_name",
  "default_phone_consent",
  "prevent_duplicate_phones",
  "default_email_consent",
  "prevent_duplicate_emails",
  "invoice_number_template",
  "invoice_due_days",
  "invoice_order_details_mode",
  "prevent_backdated_invoices",
  "default_legal_entity_id",
  "online_payments_enabled",
];

// Columns apiClients writes/filters on in createClient/updateClient/getClients.
const clientColumns = [
  "middle_name",
  "phone_notifications_consent",
  "email_notifications_consent",
  "deleted_at",
];

describe("database contract for the current frontend", () => {
  it.each(workspaceColumns)("workspaces.%s is provided by migrations or the General Settings SQL", (column) => {
    expect(providedSql).toContain(column);
  });

  it.each(clientColumns)("clients.%s is provided by migrations or the General Settings SQL", (column) => {
    expect(providedSql).toContain(column);
  });

  it("provides the legal_entities table and invoices.legal_entity_id", () => {
    expect(generalSettingsSql).toContain("create table if not exists public.legal_entities");
    expect(generalSettingsSql).toContain("add column if not exists legal_entity_id uuid");
  });

  it("provides the invoice next-number RPCs used by the settings UI", () => {
    expect(generalSettingsSql).toContain("function public.workspace_get_invoice_next_number");
    expect(generalSettingsSql).toContain("function public.workspace_set_invoice_next_number");
  });

  it("grants authenticated EXECUTE on the invoice template validator used by a CHECK constraint", () => {
    // Regression guard: CHECK constraints evaluate as the writing role.
    // Without this grant every workspace update fails with
    // "permission denied for function invoice_number_template_is_valid".
    expect(generalSettingsSql).toContain(
      "grant execute on function public.invoice_number_template_is_valid(text) to authenticated, service_role;",
    );
  });

  it("does not create a unique index over normalized client phone/email (known duplicate groups must stay valid)", () => {
    const uniqueIndex = /create unique index[^;]*(phone_normalized|email_normalized)/i;
    expect(generalSettingsSql).not.toMatch(uniqueIndex);
  });
});
