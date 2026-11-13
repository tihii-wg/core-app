import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261115120000_realtime_publication.PRODUCTION.sql"),
  "utf8",
);

describe("realtime_publication SQL", () => {
  it("is a single DO block with preflight/postflight via pg_publication_tables", () => {
    expect(sql).toMatch(/do \$realtime_publication\$/);
    expect(sql).toMatch(/\$realtime_publication\$;/);
    expect(sql).toMatch(/realtime_publication preflight/);
    expect(sql).toMatch(/realtime_publication postflight/);
    expect(sql).toMatch(/pg_publication_tables/);
    expect(sql).toMatch(/alter publication supabase_realtime add table/);
    expect(sql).not.toMatch(/create temp table/i);
  });

  it("adds phase-1 workspace-scoped tables and skips line tables / secrets", () => {
    for (const table of [
      "orders",
      "order_employees",
      "payments",
      "clients",
      "inventory_items",
      "warehouse_stock",
      "invoices",
      "expenses",
      "order_comments",
      "order_attachments",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).not.toMatch(/'order_services'/);
    expect(sql).not.toMatch(/'order_materials'/);
    expect(sql).not.toMatch(/'workspace_google/);
    expect(sql).not.toMatch(/'workspace_backup/);
    expect(sql).not.toMatch(/'google_calendar/);
    expect(sql).not.toMatch(/alter table[\s\S]*replica identity full/i);
  });
});
