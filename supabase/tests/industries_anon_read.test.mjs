// Behavioral tests for supabase/migrations/20261005010000_industries_anon_read.sql against the
// hosted TEST project. Run explicitly (reads .env.test.local); INDUSTRIES_PLAN_ONLY=1 checks the
// target without any network request.
//
// Every read and write under test runs anonymously or as a real Auth user through the publishable
// key. The secret key is used only for setup and cleanup: one run user and one inactive run
// industry, plus snapshotting and deleting run data.
//
// Persistent data is never modified: the seeded industries are only read, and workspaces and
// memberships are not touched. Run rows are tagged with the run id and removed in `after`,
// including leftovers of earlier interrupted runs.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const MIGRATION = "20261005010000_industries_anon_read.sql";
const RUN_EMAIL_PREFIX = "core-test+ind-";
const RUN_SLUG_PREFIX = "core_test_ind_";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const RUN_SLUG = `${RUN_SLUG_PREFIX}${RUN}`;
const planOnly = process.env.INDUSTRIES_PLAN_ONLY === "1";

const TABLE_DENIED = /^permission denied for table industries$/;
const COLUMNS = "id, name, slug, description, is_active, created_at";
const COUNTED_TABLES = ["industries", "workspaces", "workspace_members", "profiles"];

function resolveTarget() {
  const vars = {
    SUPABASE_TEST_URL: process.env.SUPABASE_TEST_URL,
    VITE_SUPABASE_TEST_URL: process.env.VITE_SUPABASE_TEST_URL,
    SUPABASE_TEST_SERVICE_ROLE_KEY: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
    VITE_SUPABASE_TEST_ANON_KEY: process.env.VITE_SUPABASE_TEST_ANON_KEY,
  };
  const missing = Object.entries(vars).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing TEST variables: ${missing.join(", ")}`);

  const host = new URL(vars.SUPABASE_TEST_URL).hostname;
  const ref = host.split(".")[0];
  if (!/^[a-z0-9]{20}\.supabase\.co$/.test(host)) throw new Error(`Refusing: ${host} is not a hosted Supabase project`);
  if (ref === PRODUCTION_REF) throw new Error("Refusing: SUPABASE_TEST_URL points to production");
  if (new URL(vars.VITE_SUPABASE_TEST_URL).hostname !== host) throw new Error("Refusing: SUPABASE_TEST_URL and VITE_SUPABASE_TEST_URL differ");
  return { base: `https://${host}`, ref, secretKey: vars.SUPABASE_TEST_SERVICE_ROLE_KEY, anonKey: vars.VITE_SUPABASE_TEST_ANON_KEY };
}

const target = resolveTarget();
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(target.base, target.secretKey, clientOptions);
const anon = createClient(target.base, target.anonKey, clientOptions);

const ctx = { member: null, retiredId: null, active: [] };

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? ""} ${result.error.message}`);
  return result.data;
}

function expectRejected(t, result, code, message) {
  assert.ok(result.error, `expected SQLSTATE ${code}, the operation succeeded`);
  assert.equal(result.error.code, code, `expected SQLSTATE ${code}, got ${result.error.code}: ${result.error.message}`);
  assert.match(result.error.message, message);
  t.diagnostic(`SQLSTATE ${result.error.code}: ${result.error.message}`);
}

function expectOk(result) {
  if (result.error && TABLE_DENIED.test(result.error.message)) assert.fail(`anon cannot read industries yet: apply ${MIGRATION} to the TEST project first`);
  assert.equal(result.error, null, result.error ? `${result.error.code}: ${result.error.message}` : undefined);
  return result.data;
}

async function tableCounts() {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.code} ${error.message}`);
    counts[table] = count;
  }
  counts.authUsers = 0;
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "count users");
    counts.authUsers += users.length;
    if (users.length < 1000) break;
  }
  return counts;
}

async function sweep(scope) {
  const slugFilter = scope === "run" ? RUN_SLUG : `${RUN_SLUG_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;
  check(await admin.from("industries").delete().like("slug", slugFilter), "delete run industries");
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix))) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`industries_anon_read on TEST project ${target.ref}`, { concurrency: false }, () => {
  let snapshot;

  before(async () => {
    if (planOnly) return;
    await sweep("all");
    snapshot = {
      counts: await tableCounts(),
      seeded: check(await admin.from("industries").select(COLUMNS).order("created_at"), "read seeded industries"),
    };
    ctx.active = snapshot.seeded.filter((row) => row.is_active);
    assert.ok(ctx.active.length > 0, "TEST must have at least one active industry");

    ctx.retiredId = check(
      await admin.from("industries").insert({ name: `Core test retired ${RUN}`, slug: RUN_SLUG, is_active: false }).select("id").single(),
      "create inactive run industry",
    ).id;

    const email = `${RUN_EMAIL_PREFIX}${RUN}-member@example.com`;
    const password = randomBytes(24).toString("base64url");
    check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create run user");
    ctx.member = createClient(target.base, target.anonKey, clientOptions);
    check(await ctx.member.auth.signInWithPassword({ email, password }), "sign in run user");
  });

  after(async () => {
    if (planOnly) return;
    let cleanupError;
    try {
      await sweep("run");
    } catch (error) {
      cleanupError = error;
    }
    if (!snapshot) {
      if (cleanupError) throw cleanupError;
      return;
    }
    const final = {
      counts: await tableCounts(),
      seeded: check(await admin.from("industries").select(COLUMNS).order("created_at"), "read industries after"),
    };
    console.log(`cleanup: counts before=${JSON.stringify(snapshot.counts)} after=${JSON.stringify(final.counts)}`);
    if (cleanupError) throw cleanupError;
    assert.deepEqual(final.seeded, snapshot.seeded, "seeded industries must be untouched");
    assert.deepEqual(final.counts, snapshot.counts, "every counted table must be back to its pre-run size");
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);
  const activeIds = () => ctx.active.map((row) => row.id).sort();

  it("A1 anonymous SELECT returns exactly the active industries, with the signup form's columns and order", async () => {
    const rows = expectOk(await anon.from("industries").select(COLUMNS).eq("is_active", true).order("created_at", { ascending: true }));
    assert.deepEqual(rows, ctx.active);
  });

  it("A2 anonymous SELECT without a filter still hides the inactive industry", async () => {
    const rows = expectOk(await anon.from("industries").select("id, is_active"));
    assert.deepEqual(rows.map((row) => row.id).sort(), activeIds());
    assert.ok(rows.every((row) => row.is_active === true));
    assert.deepEqual(expectOk(await anon.from("industries").select("id").eq("id", ctx.retiredId)), []);
    assert.deepEqual(expectOk(await anon.from("industries").select("id").eq("is_active", false)), []);
  });

  it("A3 anonymous lookup by slug resolves an active industry and not the inactive one", async () => {
    assert.equal(expectOk(await anon.from("industries").select("id").eq("slug", ctx.active[0].slug).maybeSingle())?.id, ctx.active[0].id);
    assert.equal(expectOk(await anon.from("industries").select("id").eq("slug", RUN_SLUG).maybeSingle()), null);
  });

  it("A4 anonymous INSERT, UPDATE and DELETE are denied at the grant level (42501); rows unchanged", async (t) => {
    expectRejected(t, await anon.from("industries").insert({ name: `Core test anon ${RUN}`, slug: `${RUN_SLUG}_anon` }), "42501", TABLE_DENIED);
    expectRejected(t, await anon.from("industries").update({ name: "changed" }).eq("id", ctx.active[0].id), "42501", TABLE_DENIED);
    expectRejected(t, await anon.from("industries").update({ is_active: true }).eq("id", ctx.retiredId), "42501", TABLE_DENIED);
    expectRejected(t, await anon.from("industries").delete().eq("id", ctx.active[0].id), "42501", TABLE_DENIED);
    assert.deepEqual(check(await admin.from("industries").select(COLUMNS).eq("id", ctx.active[0].id).single(), "read active"), ctx.active[0]);
    assert.equal(check(await admin.from("industries").select("is_active").eq("id", ctx.retiredId).single(), "read retired").is_active, false);
  });

  it("B1 authenticated SELECT is unchanged: exactly the active industries", async () => {
    const rows = expectOk(await ctx.member.from("industries").select(COLUMNS).eq("is_active", true).order("created_at", { ascending: true }));
    assert.deepEqual(rows, ctx.active);
    assert.deepEqual(expectOk(await ctx.member.from("industries").select("id").eq("id", ctx.retiredId)), []);
  });

  it("B2 authenticated INSERT, UPDATE and DELETE stay denied (42501)", async (t) => {
    expectRejected(t, await ctx.member.from("industries").insert({ name: `Core test member ${RUN}`, slug: `${RUN_SLUG}_member` }), "42501", TABLE_DENIED);
    expectRejected(t, await ctx.member.from("industries").update({ name: "changed" }).eq("id", ctx.active[0].id), "42501", TABLE_DENIED);
    expectRejected(t, await ctx.member.from("industries").delete().eq("id", ctx.active[0].id), "42501", TABLE_DENIED);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
