// Behavioral tests for supabase/migrations/20260929000500_order_services_member_delete.sql against
// the hosted TEST project. Run explicitly (reads .env.test.local); ORDER_LINES_PLAN_ONLY=1 checks
// the target without any network request.
//
// Every read and write under test runs as a real Auth user (or anonymously) through the publishable
// key. The secret key is used only for setup and cleanup: creating/deleting run users, a per-run
// workspace B, non-owner memberships (one already removed), run services, clients, orders and order
// lines, and snapshotting/deleting run data.
//
// Persistent fixtures (never modified here):
// - owner_A and "core-test fixture workspace A": only read, to prove they are untouched.
// - "core-test fixture workspace S": run users join it as non-owner members and the run orders live
//   in it. The workspace row and its owner membership are never written. Run memberships disappear
//   with their Auth users (ON DELETE CASCADE).
// Run rows are tagged with the run id and removed in `after`, including leftovers of earlier
// interrupted runs. No DELETE is ever sent to workspace_members.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_A_EMAIL = "core-test+owner-a@example.com";
const FIXTURE_WORKSPACE_A = "core-test fixture workspace A";
const FIXTURE_OWNER_S_EMAIL = "core-test+owner-s@example.com";
const FIXTURE_WORKSPACE_S = "core-test fixture workspace S";
const RUN_EMAIL_PREFIX = "core-test+osd-";
const RUN_WORKSPACE_PREFIX = "core-test osd run ";
const RUN_ROW_PREFIX = "core-test-osd-";
const RUN_ORDER_PREFIX = "CORE-TEST-OSD-";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `${RUN_ROW_PREFIX}${RUN}`;
const planOnly = process.env.ORDER_LINES_PLAN_ONLY === "1";

const TABLE_DENIED = /^permission denied for table order_services$/;
const RLS_DENIED = /^new row violates row-level security policy for table "order_services"$/;
const LINE_COLUMNS = "id, order_id, service_id, service_name, price, quantity";
const SERVICE_COLUMNS = "id, workspace_id, service_name, service_price, status, description, category, created_at";
const COUNTED_TABLES = ["workspaces", "workspace_members", "services", "clients", "orders", "order_services", "profiles"];

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

const ctx = { A: null, S: null, workspaceB: null, users: {}, services: {}, orders: {}, lines: {} };

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
  assert.equal(result.error, null, result.error ? `${result.error.code}: ${result.error.message}` : undefined);
  return result.data;
}

function anonClient() {
  return createClient(target.base, target.anonKey, clientOptions);
}

async function findFixture(name) {
  const rows = check(await admin.from("workspaces").select("*").eq("name", name), `find ${name}`);
  if (rows.length !== 1) throw new Error(`"${name}" must exist exactly once; run the workspace suites first or resolve manually`);
  if (rows[0].deleted_at) throw new Error(`"${name}" is soft-deleted; run the workspace suites' cleanup or resolve manually`);
  return rows[0];
}

async function ownerMembership(workspaceId) {
  return check(await admin.from("workspace_members").select("user_id, role, deleted_at, created_at").eq("workspace_id", workspaceId).eq("role", "owner"), "read owner membership");
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

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  const client = anonClient();
  check(await client.auth.signInWithPassword({ email, password }), `sign in ${key}`);
  ctx.users[key] = { id: created.user.id, client };
}

async function addMember(workspaceId, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} as ${role}`);
}

async function seedService(key, workspaceId, price) {
  ctx.services[key] = check(
    await admin.from("services").insert({ workspace_id: workspaceId, service_name: `${TAG} ${key}`, service_price: price, status: "active" }).select(SERVICE_COLUMNS).single(),
    `seed service ${key}`,
  );
}

async function seedOrder(key, workspaceId, lineKeys) {
  const client = check(await admin.from("clients").insert({ workspace_id: workspaceId, name: `${TAG} client ${key}` }).select("id").single(), `seed client ${key}`);
  const order = check(
    await admin.from("orders").insert({ workspace_id: workspaceId, client_id: client.id, number: `${RUN_ORDER_PREFIX}${RUN}-${key}`, assigned_to: null, created_by: null }).select("id").single(),
    `seed order ${key}`,
  );
  ctx.orders[key] = order.id;
  for (const lineKey of lineKeys) {
    const service = ctx.services[lineKey];
    ctx.lines[`${key}_${lineKey}`] = check(
      await admin.from("order_services").insert({ order_id: order.id, service_id: service.id, service_name: service.service_name, price: service.service_price, quantity: 1 }).select(LINE_COLUMNS).single(),
      `seed line ${key}/${lineKey}`,
    );
  }
}

async function lineById(id) {
  return check(await admin.from("order_services").select(LINE_COLUMNS).eq("id", id).maybeSingle(), "read line");
}

async function linesOf(orderKey) {
  return check(await admin.from("order_services").select(LINE_COLUMNS).eq("order_id", ctx.orders[orderKey]).order("created_at"), "read order lines");
}

async function serviceById(id) {
  return check(await admin.from("services").select(SERVICE_COLUMNS).eq("id", id).maybeSingle(), "read service");
}

// The exact request the app sends when an edited order drops a saved line.
function deleteLines(client, orderKey, ids) {
  return client.from("order_services").delete().eq("order_id", ctx.orders[orderKey]).in("id", ids).select("id");
}

async function sweep(scope) {
  const rowFilter = scope === "run" ? `${TAG} %` : `${RUN_ROW_PREFIX}%`;
  const orderFilter = scope === "run" ? `${RUN_ORDER_PREFIX}${RUN}%` : `${RUN_ORDER_PREFIX}%`;
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN}%` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.A?.id || !ctx.S?.id) throw new Error("Refusing to sweep before fixtures A and S are identified");
  const fixtureEmails = new Set([FIXTURE_OWNER_A_EMAIL, FIXTURE_OWNER_S_EMAIL]);
  const fixtureOwners = new Set([ctx.A.owner_id, ctx.S.owner_id]);

  // Orders cascade to their lines; order_services.service_id and services.workspace_id are NO ACTION.
  check(await admin.from("orders").delete().like("number", orderFilter), "delete run orders");
  check(await admin.from("clients").delete().like("name", rowFilter), "delete run clients");
  check(await admin.from("services").delete().like("service_name", rowFilter), "delete run services");
  check(await admin.from("workspaces").delete().like("name", workspaceFilter).neq("id", ctx.A.id).neq("id", ctx.S.id), "delete run workspaces");
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && !fixtureEmails.has(item.email) && !fixtureOwners.has(item.id))) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`order_services_member_delete on TEST project ${target.ref}`, { concurrency: false }, () => {
  let snapshot;

  before(async () => {
    if (planOnly) return;
    ctx.A = await findFixture(FIXTURE_WORKSPACE_A);
    ctx.S = await findFixture(FIXTURE_WORKSPACE_S);
    await sweep("all");
    snapshot = {
      A: ctx.A,
      S: ctx.S,
      ownerA: await ownerMembership(ctx.A.id),
      ownerS: await ownerMembership(ctx.S.id),
      counts: await tableCounts(),
    };
    assert.equal(snapshot.ownerS.length, 1, "workspace S must have exactly one owner membership");

    for (const key of ["s_member", "s_admin", "s_removed", "b_admin", "stranger"]) await createRunUser(key);
    ctx.workspaceB = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} B`, owner_id: null }).select("id").single(), "create workspace B").id;
    await addMember(ctx.S.id, "s_member", "member");
    await addMember(ctx.S.id, "s_admin", "admin");
    await addMember(ctx.S.id, "s_removed", "admin", new Date().toISOString());
    await addMember(ctx.workspaceB, "b_admin", "admin");

    await seedService("oil", ctx.S.id, 40);
    await seedService("brake", ctx.S.id, 25);
    await seedService("tires", ctx.S.id, 80);
    await seedService("b_wash", ctx.workspaceB, 15);
    await seedOrder("S1", ctx.S.id, ["oil", "brake"]);
    await seedOrder("S2", ctx.S.id, ["oil"]);
    await seedOrder("B1", ctx.workspaceB, ["b_wash"]);
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
      A: check(await admin.from("workspaces").select("*").eq("id", ctx.A.id).single(), "workspace A after"),
      S: check(await admin.from("workspaces").select("*").eq("id", ctx.S.id).single(), "workspace S after"),
      ownerA: await ownerMembership(ctx.A.id),
      ownerS: await ownerMembership(ctx.S.id),
      counts: await tableCounts(),
    };
    console.log(`cleanup: counts before=${JSON.stringify(snapshot.counts)} after=${JSON.stringify(final.counts)}`);
    if (cleanupError) throw cleanupError;
    assert.deepEqual(final.A, snapshot.A, "workspace A row must be untouched");
    assert.deepEqual(final.S, snapshot.S, "workspace S row must be untouched");
    assert.deepEqual(final.ownerA, snapshot.ownerA, "owner membership of A must be untouched");
    assert.deepEqual(final.ownerS, snapshot.ownerS, "owner membership of S must be untouched");
    assert.deepEqual(final.counts, snapshot.counts, "every counted table must be back to its pre-run size");
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  // Unchanged: SELECT, INSERT and UPDATE
  it("K1 SELECT unchanged: members of S read S1's lines; removed member, other workspace's admin and non-member read none; anonymous is denied (42501)", async (t) => {
    for (const key of ["s_member", "s_admin"]) {
      assert.equal(expectOk(await ctx.users[key].client.from("order_services").select("id").eq("order_id", ctx.orders.S1)).length, 2, key);
    }
    for (const key of ["s_removed", "b_admin", "stranger"]) {
      assert.deepEqual(expectOk(await ctx.users[key].client.from("order_services").select("id").eq("order_id", ctx.orders.S1)), [], key);
    }
    expectRejected(t, await anonClient().from("order_services").select("id").eq("order_id", ctx.orders.S1), "42501", TABLE_DENIED);
  });

  it("K2 INSERT unchanged: other workspace's admin and removed member cannot add a line to S1 (42501)", async (t) => {
    for (const key of ["b_admin", "s_removed"]) {
      const service = ctx.services.tires;
      expectRejected(t, await ctx.users[key].client.from("order_services").insert({ order_id: ctx.orders.S1, service_id: service.id, service_name: service.service_name, price: 1, quantity: 1 }), "42501", RLS_DENIED);
    }
    assert.equal((await linesOf("S1")).length, 2);
  });

  it("K3 UPDATE still revoked for authenticated (42501), line unchanged", async (t) => {
    expectRejected(t, await ctx.users.s_member.client.from("order_services").update({ price: 1 }).eq("id", ctx.lines.S1_oil.id), "42501", TABLE_DENIED);
    assert.deepEqual(await lineById(ctx.lines.S1_oil.id), ctx.lines.S1_oil);
  });

  // New: DELETE limited to active members of the order's workspace
  it("X1 anonymous DELETE is denied at the grant level (42501)", async (t) => {
    expectRejected(t, await deleteLines(anonClient(), "S1", [ctx.lines.S1_brake.id]), "42501", TABLE_DENIED);
    assert.deepEqual(await lineById(ctx.lines.S1_brake.id), ctx.lines.S1_brake);
  });

  it("X2 other workspace's admin, removed admin of S and non-member delete nothing (no rows, no error); line still there", async () => {
    for (const key of ["b_admin", "s_removed", "stranger"]) {
      assert.deepEqual(expectOk(await deleteLines(ctx.users[key].client, "S1", [ctx.lines.S1_brake.id])), [], key);
      assert.deepEqual(expectOk(await ctx.users[key].client.from("order_services").delete().eq("id", ctx.lines.S1_brake.id).select("id")), [], `${key} by id only`);
    }
    assert.deepEqual(await lineById(ctx.lines.S1_brake.id), ctx.lines.S1_brake);
  });

  it("X3 members of S cannot delete a line of workspace B's order", async () => {
    for (const key of ["s_member", "s_admin"]) {
      assert.deepEqual(expectOk(await deleteLines(ctx.users[key].client, "B1", [ctx.lines.B1_b_wash.id])), [], key);
    }
    assert.deepEqual(await lineById(ctx.lines.B1_b_wash.id), ctx.lines.B1_b_wash);
  });

  it("X4 the app's order_id filter keeps a line of another order out of reach even inside the same workspace", async () => {
    assert.deepEqual(expectOk(await deleteLines(ctx.users.s_member.client, "S1", [ctx.lines.S2_oil.id])), []);
    assert.deepEqual(await lineById(ctx.lines.S2_oil.id), ctx.lines.S2_oil);
  });

  it("X5 a plain member of S deletes S1's brake line; the other line and the global services stay untouched", async () => {
    const before = { brake: await serviceById(ctx.services.brake.id), oil: await serviceById(ctx.services.oil.id) };
    assert.deepEqual(expectOk(await deleteLines(ctx.users.s_member.client, "S1", [ctx.lines.S1_brake.id])), [{ id: ctx.lines.S1_brake.id }]);
    assert.equal(await lineById(ctx.lines.S1_brake.id), null);
    assert.deepEqual(await linesOf("S1"), [ctx.lines.S1_oil]);
    assert.deepEqual(await serviceById(ctx.services.brake.id), before.brake, "global brake service must be untouched");
    assert.deepEqual(await serviceById(ctx.services.oil.id), before.oil, "global oil service must be untouched");
    assert.deepEqual(await lineById(ctx.lines.S2_oil.id), ctx.lines.S2_oil, "S2 line must be untouched");
  });

  it("X6 the member's own read agrees: S1 now has exactly the oil line", async () => {
    assert.deepEqual(expectOk(await ctx.users.s_member.client.from("order_services").select(LINE_COLUMNS).eq("order_id", ctx.orders.S1)), [ctx.lines.S1_oil]);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
