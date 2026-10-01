// Reviews a snapshot exported from production_snapshot.sql (SQL Editor "Copy as JSON" or CSV):
// section completeness, item counts, secret-like strings, and which objects from the
// repository migrations the snapshotted database actually has.
//
//   node supabase/snapshot/inspect_snapshot.mjs supabase/snapshot/production_snapshot.json

import { readFileSync } from "node:fs";

const SECTIONS = [
  "meta", "extensions", "schemas", "other_schemas", "roles", "types", "relations", "columns",
  "constraints", "indexes", "sequences", "views", "functions", "triggers", "policies", "table_grants",
  "column_grants", "function_grants", "default_privileges", "storage_buckets", "publications",
  "event_triggers", "migration_history", "cron_jobs",
];
const XML_SECTIONS = new Set(["migration_history", "cron_jobs"]);

// Columns the application reads or writes (services layer), per table.
const APP_COLUMNS = {
  profiles: ["id", "full_name", "email", "phone", "active_workspace_id", "theme"],
  workspaces: ["id", "name", "owner_id", "industry_id", "deleted_at", "avatar_path", "language", "timezone", "date_format", "currency", "created_at"],
  workspace_members: ["workspace_id", "user_id", "role", "deleted_at", "created_at"],
  industries: ["id", "name", "slug", "description", "is_active", "created_at"],
  clients: ["id", "workspace_id", "name", "email", "phone", "address", "notes", "client_type", "tax_id", "contact_person", "balance", "created_at"],
  employees: ["id", "workspace_id", "name", "email", "phone", "role", "status", "profile_id"],
  services: ["id", "workspace_id", "service_name", "service_price", "description", "status", "category"],
  orders: ["id", "workspace_id", "client_id", "number", "device", "car_number", "vin", "description", "status", "assigned_to", "deadline", "total_price", "is_paid", "service", "service_id", "created_at", "updated_at"],
  order_services: ["id", "order_id", "service_id", "service_name", "price", "quantity"],
  inventory_items: ["id", "workspace_id", "name", "sku", "description", "category", "quantity", "min_quantity", "unit", "purchase_price", "selling_price", "supplier", "location", "is_active", "created_at", "updated_at"],
};

// Objects each archived migration (supabase/migrations_archive/) creates, so the snapshot shows which ones are live.
const MIGRATIONS = {
  "20260927134100_industries": [
    ["relation", "public.industries"],
    ["constraint", "industries.industries_slug_key"],
    ["column", "workspaces.industry_id"],
    ["constraint", "workspaces.workspaces_industry_id_fkey"],
    ["index", "workspaces.workspaces_industry_id_idx"],
    ["rls", "public.industries"],
    ["policy", "public.industries.Active industries are readable"],
    ["grant", "public.industries.anon.SELECT"],
    ["grant", "public.industries.authenticated.SELECT"],
  ],
  "20260927144500_workspace_member_rls (superseded)": [
    ["function", "is_workspace_owner(target_workspace uuid)"],
    ["policy", "public.workspace_members.Members can read their workspace memberships"],
    ["policy", "public.workspace_members.Owners can add workspace members"],
    ["policy", "public.workspace_members.Owners can update workspace members"],
    ["policy", "public.workspace_members.Owners can delete workspace members"],
  ],
  "20260927161000_inventory_markup": [
    ["column", "workspaces.inventory_markup_percent"],
    ["constraint", "workspaces.workspaces_inventory_markup_percent_check"],
  ],
  "20260927180400_workspace_logo": [
    ["column", "workspaces.avatar_path"],
    ["constraint", "workspaces.workspaces_avatar_path_check"],
    ["function", "is_workspace_member(target_workspace uuid)"],
    ["function", "workspace_logo_id(object_name text)"],
    ["bucket", "workspace"],
    ["policy", "storage.objects.Members can read workspace logos"],
    ["policy", "storage.objects.Members can upload workspace logos"],
    ["policy", "storage.objects.Members can update workspace logos"],
    ["policy", "storage.objects.Members can delete workspace logos"],
    ["policy", "public.workspaces.Members can update workspaces they belong to"],
  ],
  "20260927220900_workspace_avatar_path": [
    ["column", "workspaces.avatar_path"],
    ["constraint", "workspaces.workspaces_avatar_path_check"],
  ],
  "20260928200000_team_members_rls": [
    ["function", "workspace_member_role(target_workspace uuid)"],
    ["function", "workspace_member_is_owner(target_workspace uuid)"],
    ["function", "workspace_member_is_admin(target_workspace uuid)"],
    ["function", "workspace_member_can_manage(target_workspace uuid, target_role text)"],
    ["function", "workspace_member_can_bootstrap(target_workspace uuid)"],
    ["function", "workspace_member_profiles(target_workspace uuid)"],
    ["function", "workspace_member_find_user(target_workspace uuid, member_email text)"],
    ["function", "soft_delete_workspace(target_workspace uuid)"],
    ["function", "workspace_members_guard()"],
    ["trigger", "public.workspace_members.workspace_members_guard"],
    ["policy", "public.workspace_members.Team members can view their workspace members"],
    ["policy", "public.workspace_members.Owners and admins can add team members"],
    ["policy", "public.workspace_members.Owners and admins can update team members"],
    ["column_grant", "workspace_members.workspace_id.authenticated.INSERT"],
    ["column_grant", "workspace_members.user_id.authenticated.INSERT"],
    ["column_grant", "workspace_members.role.authenticated.INSERT"],
    ["column_grant", "workspace_members.role.authenticated.UPDATE"],
    ["column_grant", "workspace_members.deleted_at.authenticated.UPDATE"],
    ["no_grant", "public.workspace_members.authenticated.DELETE"],
    ["no_grant", "public.workspace_members.authenticated.INSERT"],
    ["no_grant", "public.workspace_members.authenticated.UPDATE"],
  ],
};

const SECRET_PATTERNS = [
  ["JWT", /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]+/g],
  ["Supabase publishable key", /sb_publishable_[A-Za-z0-9_-]+/g],
  ["Bearer token", /bearer\s+[A-Za-z0-9._-]{16,}/gi],
  ["password literal", /password\s*[:=]\s*'[^']+'/gi],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["URL with credentials", /[a-z]+:\/\/[^\s/:@'"]+:[^\s/@'"]+@/gi],
  ["http(s) URL", /https?:\/\/[^\s'"\\]+/gi],
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((cell) => cell !== ""));
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index]])));
}

export function loadSnapshot(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const rows = text.trimStart().startsWith("[") || text.trimStart().startsWith("{") ? JSON.parse(text) : parseCsv(text);
  const list = Array.isArray(rows) ? rows : rows.rows ?? rows.result ?? [];
  const sections = {};
  for (const row of list) {
    let items = row.items;
    if (typeof items === "string" && !XML_SECTIONS.has(row.section)) items = JSON.parse(items);
    if (XML_SECTIONS.has(row.section) && typeof items === "string" && items.startsWith('"')) items = JSON.parse(items);
    sections[row.section] = { itemCount: Number(row.item_count), items };
  }
  return { text, sections };
}

function xmlEntries(xml) {
  if (!xml || typeof xml !== "string") return [];
  return [...xml.matchAll(/<row>([\s\S]*?)<\/row>/g)].map((match) =>
    Object.fromEntries([...match[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(([, key, value]) => [key, value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")])),
  );
}

function has(sections, kind, key) {
  const list = (name) => sections[name]?.items ?? [];
  switch (kind) {
    case "relation": return list("relations").some((r) => `${r.schema}.${r.name}` === key);
    case "rls": return list("relations").some((r) => `${r.schema}.${r.name}` === key && r.rls_enabled);
    case "column": return list("columns").some((c) => `${c.table}.${c.name}` === key);
    case "constraint": return list("constraints").some((c) => `${c.table}.${c.name}` === key);
    case "index": return list("indexes").some((i) => `${i.table}.${i.name}` === key);
    case "function": return list("functions").some((f) => `${f.name}(${f.identity_args})` === key);
    case "trigger": return list("triggers").some((t) => `${t.schema}.${t.table}.${t.name}` === key);
    case "policy": return list("policies").some((p) => `${p.schema}.${p.table}.${p.name}` === key);
    case "grant": return list("table_grants").some((g) => `${g.schema}.${g.table}.${g.grantee}.${g.privilege}` === key);
    case "no_grant": return !list("table_grants").some((g) => `${g.schema}.${g.table}.${g.grantee}.${g.privilege}` === key);
    case "column_grant": return list("column_grants").some((g) => `${g.table}.${g.column}.${g.grantee}.${g.privilege}` === key);
    case "bucket": return list("storage_buckets").some((b) => b.id === key);
    default: throw new Error(`unknown kind ${kind}`);
  }
}

function main(path) {
  const { text, sections } = loadSnapshot(path);
  const problems = [];
  const out = (line = "") => console.log(line);

  out("## 1. Sections and item counts");
  for (const name of SECTIONS) {
    const section = sections[name];
    if (!section) { problems.push(`missing section ${name}`); out(`MISSING  ${name}`); continue; }
    const actual = XML_SECTIONS.has(name) ? xmlEntries(section.items).length : Array.isArray(section.items) ? section.items.length : 1;
    const ok = actual === section.itemCount;
    if (!ok) problems.push(`${name}: item_count ${section.itemCount} but ${actual} items (truncated export?)`);
    out(`${ok ? "ok      " : "MISMATCH"} ${name.padEnd(20)} item_count=${section.itemCount} parsed=${actual}`);
  }
  const extra = Object.keys(sections).filter((name) => !SECTIONS.includes(name));
  if (extra.length) out(`unexpected sections: ${extra.join(", ")}`);

  out("\n## 2. Secret-like strings (review every hit before committing)");
  for (const [label, pattern] of SECRET_PATTERNS) {
    const hits = [...new Set(text.match(pattern) ?? [])].filter((hit) => !hit.startsWith("http://www.w3.org/"));
    if (hits.length) out(`${label}: ${hits.length} distinct — ${hits.slice(0, 5).map((hit) => hit.slice(0, 60)).join(" | ")}`);
  }
  const redacted = (text.match(/<redacted-[a-z-]+>|<arguments redacted>/g) ?? []).length;
  out(`already redacted by the query: ${redacted}`);

  const meta = sections.meta?.items ?? {};
  out(`\n## 3. Source\nserver ${meta.server_version}, captured ${meta.captured_at} by ${meta.captured_by}`);

  out("\n## 4. Repository migrations vs snapshot");
  for (const [migration, objects] of Object.entries(MIGRATIONS)) {
    const missing = objects.filter(([kind, key]) => !has(sections, kind, key));
    const state = missing.length === 0 ? "PRESENT" : missing.length === objects.length ? "ABSENT" : "PARTIAL";
    out(`${state.padEnd(8)} ${migration}${missing.length && missing.length < objects.length ? `  missing: ${missing.map(([kind, key]) => `${kind} ${key}`).join("; ")}` : ""}`);
  }
  const applied = xmlEntries(sections.migration_history?.items).map((entry) => entry.entry ?? JSON.stringify(entry));
  out(`CLI migration history: ${applied.length ? applied.join(", ") : "none recorded"}`);

  out("\n## 5. Tables the app uses");
  const relations = sections.relations?.items ?? [];
  const columns = sections.columns?.items ?? [];
  const policies = sections.policies?.items ?? [];
  const tableGrants = sections.table_grants?.items ?? [];
  for (const [table, expected] of Object.entries(APP_COLUMNS)) {
    const relation = relations.find((r) => r.schema === "public" && r.name === table);
    if (!relation) { out(`ABSENT   ${table}`); problems.push(`table ${table} missing`); continue; }
    const present = new Set(columns.filter((c) => c.table === table).map((c) => c.name));
    const missing = expected.filter((name) => !present.has(name));
    const tablePolicies = policies.filter((p) => p.schema === "public" && p.table === table);
    const grants = ["anon", "authenticated"].map((role) => `${role}:${tableGrants.filter((g) => g.schema === "public" && g.table === table && g.grantee === role).map((g) => g.privilege[0]).sort().join("") || "-"}`);
    out(`${relation.rls_enabled ? "RLS on " : "RLS OFF"}  ${table.padEnd(18)} policies=${tablePolicies.length} ${grants.join(" ")}${missing.length ? `  columns the app uses but absent: ${missing.join(", ")}` : ""}`);
    if (!relation.rls_enabled) problems.push(`RLS disabled on ${table}`);
  }
  const markup = ["inventory_markup", "inventory_markup_percent"].filter((name) => columns.some((c) => c.table === "workspaces" && c.name === name));
  out(`workspaces markup column(s): ${markup.join(", ") || "none"}`);
  const view = (sections.views?.items ?? []).find((v) => v.name === "inventory_items_with_status");
  out(`inventory_items_with_status: ${view ? `present, options=${JSON.stringify(view.options)}${(view.options ?? []).some((o) => /security_invoker=(true|on|1)/i.test(o)) ? "" : "  <-- NOT security_invoker: bypasses inventory_items RLS"}` : "ABSENT"}`);

  out("\n## 6. SECURITY DEFINER functions without an empty search_path");
  for (const fn of (sections.functions?.items ?? []).filter((f) => f.security_definer)) {
    const path = (fn.config ?? []).find((setting) => setting.startsWith("search_path="));
    if (path !== 'search_path=""' && path !== "search_path=") out(`${fn.name}(${fn.identity_args}) ${path ?? "no search_path"}`);
  }

  out(`\n## Result: ${problems.length ? `${problems.length} problem(s)\n- ${problems.join("\n- ")}` : "no structural problems"}`);
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[2]) main(process.argv[2]);
