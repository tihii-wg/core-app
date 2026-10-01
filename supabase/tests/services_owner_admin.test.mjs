// Behavioral tests for supabase/migrations/20260929000200_services_owner_admin.sql against the
// hosted TEST project. Run explicitly with `npm run test:supabase` (reads .env.test.local).
// SERVICES_PLAN_ONLY=1 checks the target and lists the steps without any network write.
//
// Every read and write under test runs as a real Auth user (or anonymously) through the
// publishable key. The secret key is used only for setup and cleanup: creating/deleting run users,
// per-run workspaces, non-owner memberships (one already removed), run services, a run client,
// order and order line, soft-deleting a per-run workspace, issuing a sign-in link for owner_S, and
// snapshotting/deleting run data.
//
// Persistent fixtures (never modified here):
// - owner_A and "core-test fixture workspace A": only read, to prove they are untouched.
// - owner_S (core-test+owner-s@example.com) and "core-test fixture workspace S": the workspace the
//   run services live in. The workspace row and its owner membership are never written.
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
const RUN_EMAIL_PREFIX = "core-test+svc-";
const RUN_WORKSPACE_PREFIX = "core-test svc run ";
const RUN_ROW_PREFIX = "core-test-svc-";
const RUN_ORDER_PREFIX = "CORE-TEST-SVC-";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `${RUN_ROW_PREFIX}${RUN}`;
const planOnly = process.env.SERVICES_PLAN_ONLY === "1";

const RLS_DENIED = /^new row violates row-level security policy for table "services"$/;
const TABLE_DENIED = /^permission denied for table services$/;
const WORKSPACE_LOCKED = /^workspace_id cannot be changed$/;
const STILL_REFERENCED = /violates foreign key constraint "order_services_service_id_fkey" on table "order_services"/;
const SERVICE_COLUMNS = "id, workspace_id, service_name, service_price, status, description, category, created_at";
const COUNTED_TABLES = ["workspaces", "workspace_members", "services", "clients", "orders", "order_services", "employees", "profiles"];

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

const ctx = { A: null, S: null, workspaceB: null, workspaceD: null, ownerS: null, users: {}, services: {}, orderLine: null };

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

async function signedInClient(email, password) {
  const client = anonClient();
  check(await client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return client;
}

async function linkSignedInClient(email) {
  const link = check(await admin.auth.admin.generateLink({ type: "magiclink", email }), `sign-in link for ${email}`);
  const client = anonClient();
  check(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }), `verify sign-in link for ${email}`);
  return client;
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

async function servicesOutsideRun() {
  return check(await admin.from("services").select(SERVICE_COLUMNS).not("service_name", "like", `${RUN_ROW_PREFIX}%`).order("id"), "snapshot pre-existing services");
}

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  ctx.users[key] = { id: created.user.id, email, client: await signedInClient(email, password) };
}

async function addMember(workspaceId, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} as ${role}`);
}

async function createRunWorkspace(label) {
  return check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} ${label}`, owner_id: null }).select("id").single(), `create workspace ${label}`).id;
}

async function seedService(key, workspaceId, price) {
  const row = check(
    await admin.from("services").insert({ workspace_id: workspaceId, service_name: `${TAG} ${key}`, service_price: price, status: "active", description: `seed ${key}` }).select(SERVICE_COLUMNS).single(),
    `seed service ${key}`,
  );
  ctx.services[key] = row;
}

function clientOf(key) {
  return key === "owner_S" ? ctx.ownerS : ctx.users[key].client;
}

// owner_S reads through RLS as an active owner of S.
async function readAsOwner(serviceId) {
  return expectOk(await ctx.ownerS.from("services").select(SERVICE_COLUMNS).eq("id", serviceId).maybeSingle());
}

function updateService(key, serviceId, fields) {
  return clientOf(key).from("services").update(fields).eq("id", serviceId).select("id, service_price");
}

function deleteService(key, serviceId) {
  return clientOf(key).from("services").delete().eq("id", serviceId).select("id");
}

function insertService(key, workspaceId, label) {
  return clientOf(key).from("services").insert({ workspace_id: workspaceId, service_name: `${TAG} ${label}`, service_price: 5, status: "active" }).select(SERVICE_COLUMNS);
}

async function sweep(scope) {
  const rowFilter = scope === "run" ? `${TAG} %` : `${RUN_ROW_PREFIX}%`;
  const orderFilter = scope === "run" ? `${RUN_ORDER_PREFIX}${RUN}%` : `${RUN_ORDER_PREFIX}%`;
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN} %` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.A?.id || !ctx.S?.id) throw new Error("Refusing to sweep before fixtures A and S are identified");
  const fixtureEmails = new Set([FIXTURE_OWNER_A_EMAIL, FIXTURE_OWNER_S_EMAIL]);
  const fixtureOwners = new Set([ctx.A.owner_id, ctx.S.owner_id]);

  // order_services.service_id is NO ACTION, so order lines (via their orders) go before services,
  // and services.workspace_id is NO ACTION, so services go before their run workspaces.
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

describe(`services_owner_admin on TEST project ${target.ref}`, { concurrency: false }, () => {
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
      services: await servicesOutsideRun(),
      counts: await tableCounts(),
    };
    assert.equal(snapshot.ownerS.length, 1, "workspace S must have exactly one owner membership");
    assert.equal(snapshot.ownerS[0].deleted_at, null);

    for (const key of ["s_admin", "s_manager", "s_member", "s_removed", "b_admin", "d_admin", "stranger"]) await createRunUser(key);
    ctx.workspaceB = await createRunWorkspace("B");
    ctx.workspaceD = await createRunWorkspace("D");
    await addMember(ctx.S.id, "s_admin", "admin");
    await addMember(ctx.S.id, "s_manager", "manager");
    await addMember(ctx.S.id, "s_member", "member");
    await addMember(ctx.S.id, "s_removed", "admin", new Date().toISOString());
    await addMember(ctx.workspaceB, "b_admin", "admin");
    await addMember(ctx.workspaceD, "d_admin", "admin");

    await seedService("read", ctx.S.id, 10);
    await seedService("update", ctx.S.id, 20);
    await seedService("del_manager", ctx.S.id, 30);
    await seedService("del_member", ctx.S.id, 31);
    await seedService("del_outsider", ctx.S.id, 32);
    await seedService("del_admin", ctx.S.id, 33);
    await seedService("del_owner", ctx.S.id, 34);
    await seedService("used", ctx.S.id, 40);
    await seedService("in_B", ctx.workspaceB, 50);
    await seedService("in_D", ctx.workspaceD, 60);

    const client = check(await admin.from("clients").insert({ workspace_id: ctx.S.id, name: `${TAG} client` }).select("id").single(), "seed client");
    const order = check(
      await admin.from("orders").insert({ workspace_id: ctx.S.id, client_id: client.id, number: `${RUN_ORDER_PREFIX}${RUN}-1`, assigned_to: null, created_by: null }).select("id").single(),
      "seed order",
    );
    ctx.orderLine = check(
      await admin.from("order_services").insert({ order_id: order.id, service_id: ctx.services.used.id, service_name: ctx.services.used.service_name, price: 40, quantity: 1 }).select("id, order_id, service_id, service_name, price, quantity").single(),
      "seed order line",
    );
    check(await admin.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", ctx.workspaceD), "soft-delete workspace D");
    ctx.ownerS = await linkSignedInClient(FIXTURE_OWNER_S_EMAIL);
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
      services: await servicesOutsideRun(),
      counts: await tableCounts(),
    };
    console.log(`cleanup: counts before=${JSON.stringify(snapshot.counts)} after=${JSON.stringify(final.counts)}, pre-existing services=${final.services.length}`);
    if (cleanupError) throw cleanupError;
    assert.deepEqual(final.A, snapshot.A, "workspace A row must be untouched");
    assert.deepEqual(final.S, snapshot.S, "workspace S row must be untouched");
    assert.deepEqual(final.ownerA, snapshot.ownerA, "owner membership of A must be untouched");
    assert.deepEqual(final.ownerS, snapshot.ownerS, "owner membership of S must be untouched");
    assert.deepEqual(final.services, snapshot.services, "pre-existing services must be untouched");
    assert.deepEqual(final.counts, snapshot.counts, "every counted table must be back to its pre-run size");
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  // V. SELECT stays available to active members only
  for (const key of ["owner_S", "s_admin", "s_manager", "s_member"]) {
    it(`V1 ${key} reads the services of S`, async () => {
      const rows = expectOk(await clientOf(key).from("services").select("id").eq("workspace_id", ctx.S.id).like("service_name", `${TAG} %`));
      assert.equal(rows.length, 8, "all eight run services of S must be visible");
    });
  }

  it("V2 removed member, admin of another workspace and non-member read nothing; anonymous request is denied (42501)", async (t) => {
    for (const key of ["s_removed", "b_admin", "stranger"]) {
      assert.deepEqual(expectOk(await clientOf(key).from("services").select("id").eq("workspace_id", ctx.S.id)), [], key);
    }
    assert.deepEqual(expectOk(await ctx.users.s_admin.client.from("services").select("id").eq("id", ctx.services.in_B.id)), [], "admin of S cannot read B's service");
    expectRejected(t, await anonClient().from("services").select("id").eq("workspace_id", ctx.S.id), "42501", TABLE_DENIED);
  });

  it("V3 admin of a soft-deleted workspace cannot read its services", async () => {
    assert.deepEqual(expectOk(await ctx.users.d_admin.client.from("services").select("id").eq("id", ctx.services.in_D.id)), []);
  });

  // C. INSERT stays owner/admin only
  for (const key of ["owner_S", "s_admin"]) {
    it(`C1 ${key} creates a service in S and reads it back`, async () => {
      const rows = expectOk(await insertService(key, ctx.S.id, `created by ${key}`));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].workspace_id, ctx.S.id);
    });
  }

  it("C2 manager, member, removed member and admin of another workspace cannot create a service in S (42501)", async (t) => {
    for (const key of ["s_manager", "s_member", "s_removed", "b_admin"]) {
      expectRejected(t, await insertService(key, ctx.S.id, `denied ${key}`), "42501", RLS_DENIED);
    }
  });

  it("C3 admin of a soft-deleted workspace cannot create a service there (42501)", async (t) => {
    expectRejected(t, await insertService("d_admin", ctx.workspaceD, "denied d_admin"), "42501", RLS_DENIED);
  });

  // U. UPDATE becomes owner/admin only
  for (const [key, price] of [["owner_S", 21], ["s_admin", 22]]) {
    it(`U1 ${key} updates a service of S`, async () => {
      const rows = expectOk(await updateService(key, ctx.services.update.id, { service_price: price }));
      assert.deepEqual(rows, [{ id: ctx.services.update.id, service_price: price }]);
    });
  }

  for (const key of ["s_manager", "s_member"]) {
    it(`U2 ${key} cannot update a service of S (no rows, no error, row unchanged)`, async () => {
      const before = await readAsOwner(ctx.services.update.id);
      const rows = expectOk(await updateService(key, ctx.services.update.id, { service_price: 99, description: `edited by ${key}` }));
      assert.deepEqual(rows, [], `${key} must not update services`);
      assert.deepEqual(await readAsOwner(ctx.services.update.id), before);
    });
  }

  it("U3 removed member, admin of another workspace and non-member cannot update; admin of S cannot update B's service", async () => {
    const before = await readAsOwner(ctx.services.update.id);
    for (const key of ["s_removed", "b_admin", "stranger"]) {
      assert.deepEqual(expectOk(await updateService(key, ctx.services.update.id, { service_price: 98 })), [], key);
    }
    assert.deepEqual(expectOk(await updateService("s_admin", ctx.services.in_B.id, { service_price: 97 })), [], "s_admin on B");
    assert.deepEqual(await readAsOwner(ctx.services.update.id), before);
  });

  it("U4 moving a service to another workspace is rejected (42501); the other workspace's admin sees no row", async (t) => {
    expectRejected(t, await updateService("s_admin", ctx.services.update.id, { workspace_id: ctx.workspaceB }), "42501", WORKSPACE_LOCKED);
    assert.deepEqual(expectOk(await updateService("b_admin", ctx.services.update.id, { workspace_id: ctx.workspaceB })), []);
    assert.equal((await readAsOwner(ctx.services.update.id)).workspace_id, ctx.S.id);
  });

  it("U5 admin of a soft-deleted workspace cannot update its service", async () => {
    assert.deepEqual(expectOk(await updateService("d_admin", ctx.services.in_D.id, { service_price: 61 })), []);
  });

  // D. DELETE becomes owner/admin only; referenced services stay protected by the FK
  for (const [key, serviceKey] of [["s_manager", "del_manager"], ["s_member", "del_member"]]) {
    it(`D1 ${key} cannot delete an unreferenced service of S (no rows, no error, row still there)`, async () => {
      assert.deepEqual(expectOk(await deleteService(key, ctx.services[serviceKey].id)), [], `${key} must not delete services`);
      assert.ok(await readAsOwner(ctx.services[serviceKey].id), "service must still exist");
    });
  }

  it("D2 removed member, admin of another workspace and non-member cannot delete; admin of S cannot delete B's service", async () => {
    for (const key of ["s_removed", "b_admin", "stranger"]) {
      assert.deepEqual(expectOk(await deleteService(key, ctx.services.del_outsider.id)), [], key);
    }
    assert.ok(await readAsOwner(ctx.services.del_outsider.id));
    assert.deepEqual(expectOk(await deleteService("s_admin", ctx.services.in_B.id)), [], "s_admin on B");
  });

  it("D3 admin of a soft-deleted workspace cannot delete its service", async () => {
    assert.deepEqual(expectOk(await deleteService("d_admin", ctx.services.in_D.id)), []);
  });

  for (const [key, serviceKey] of [["s_admin", "del_admin"], ["owner_S", "del_owner"]]) {
    it(`D4 ${key} deletes an unreferenced service of S`, async () => {
      assert.deepEqual(expectOk(await deleteService(key, ctx.services[serviceKey].id)), [{ id: ctx.services[serviceKey].id }]);
      assert.equal(await readAsOwner(ctx.services[serviceKey].id), null);
    });
  }

  it("D5 deleting a service referenced by an order is rejected by order_services_service_id_fkey (23503) for owner and admin; history intact", async (t) => {
    for (const key of ["owner_S", "s_admin"]) {
      expectRejected(t, await deleteService(key, ctx.services.used.id), "23503", STILL_REFERENCED);
    }
    assert.deepEqual(await readAsOwner(ctx.services.used.id), ctx.services.used);
    const line = expectOk(await ctx.ownerS.from("order_services").select("id, order_id, service_id, service_name, price, quantity").eq("id", ctx.orderLine.id).maybeSingle());
    assert.deepEqual(line, ctx.orderLine);
  });

  it("D6 every active member can see the order line, so the app's pre-delete check works for any role", async () => {
    for (const key of ["owner_S", "s_admin", "s_manager", "s_member"]) {
      const rows = expectOk(await clientOf(key).from("order_services").select("id").eq("service_id", ctx.services.used.id).limit(1));
      assert.equal(rows.length, 1, key);
    }
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
