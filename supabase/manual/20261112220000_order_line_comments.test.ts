import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112220000_order_line_comments.PRODUCTION.sql"),
  "utf8",
);

describe("order_line_comments SQL", () => {
  it("is a single DO block with loud preflight/postflight and schema reload", () => {
    expect(sql).toMatch(/do \$order_line_comments\$/);
    expect(sql).toMatch(/\$order_line_comments\$;/);
    expect(sql).toMatch(/order_line_comments preflight/);
    expect(sql).toMatch(/order_line_comments postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/create temp table/i);
  });

  it("adds workspaces.line_comments_visibility with private/public check", () => {
    // Added with its default (no mass UPDATE over workspaces → no row triggers fire).
    expect(sql).toMatch(/add column line_comments_visibility text not null default 'private'/);
    // MAINTAIN only exists in Postgres 17+.
    expect(sql).not.toMatch(/\bmaintain\b/i);
    expect(sql).toMatch(/line_comments_visibility in \('private', 'public'\)/);
    expect(sql).toMatch(/set default 'private'/);
  });

  it("creates order_line_comments with one-of-line check and unique line FKs", () => {
    expect(sql).toMatch(/create table if not exists public\.order_line_comments/);
    expect(sql).toMatch(/num_nonnulls\(order_service_id, order_material_id\) = 1/);
    expect(sql).toMatch(/unique \(order_service_id\)/);
    expect(sql).toMatch(/unique \(order_material_id\)/);
    expect(sql).toMatch(/char_length\(btrim\(body\)\) between 1 and 500/);
  });

  it("exposes visibility helper and select-only RLS; writes via RPC", () => {
    expect(sql).toMatch(/crm_line_comments_visible\(p_ws uuid\)/);
    expect(sql).toMatch(/create policy order_line_comments_select/);
    expect(sql).toMatch(/crm_set_order_line_comment\(/);
    expect(sql).toMatch(/order_lifecycle:closed_order_immutable/);
    expect(sql).toMatch(/grant execute on function public\.crm_set_order_line_comment/);
  });
});
