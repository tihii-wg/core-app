// Behavioral tests for supabase/migrations/20260929000350_employee_profile_link.sql against the
// hosted TEST project. Run explicitly with `npm run test:supabase` (reads .env.test.local).
// EMPLOYEE_LINK_PLAN_ONLY=1 checks the target and lists the steps without any network write.
//
// Every assertion runs as a real Auth user through the publishable (anon) key. The secret key is
// used only for setup and cleanup: creating/deleting run users, per-run workspaces, non-owner
// memberships, soft-deleting a member or a per-run workspace, and deleting run data.
//
// Persistent fixture, created once through the real owner flow and never modified afterwards:
// owner_A (core-test+owner-a@example.com), workspace "core-test fixture workspace A" and its owner
// membership. Owner memberships cannot be deleted (protect_workspace_owner), so it is reused.
// Everything else is tagged with the run id and removed in `after`, including leftovers of
// earlier interrupted runs. No DELETE is ever sent to workspace_members; removing a run user or a
// per-run workspace deletes that user's/workspace's non-owner memberships through the FK cascade.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_EMAIL = "core-test+owner-a@example.com";
const FIXTURE_WORKSPACE_A = "core-test fixture workspace A";
const RUN_EMAIL_PREFIX = "core-test+emplink-";
const RUN_WORKSPACE_PREFIX = "core-test emplink run ";
const RUN_EMPLOYEE_PREFIX = "emplink-";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `${RUN_EMPLOYEE_PREFIX}${RUN}`;
const planOnly = process.env.EMPLOYEE_LINK_PLAN_ONLY === "1";

const RLS_DENIED = /^new row violates row-level security policy for table "employees"$/;
const NOT_ACTIVE_MEMBER = /^Selected user is not an active member of this workspace$/;
const WORKSPACE_LOCKED = /^workspace_id cannot be changed$/;

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

const ctx = { workspaceA: null, ownerId: null, workspaceB: null, deletedWorkspace: null, users: {}, employees: {} };
const ghostId = randomUUID();

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? ""} ${result.error.message}`);
  return result.data;
}

function expectRejected(t, result, code, message) {
  assert.ok(result.error, `expected SQLSTATE ${code}, the operation succeeded`);
  assert.equal(result.error.code, code, `expected SQLSTATE ${code}, got ${result.error.code}: ${result.error.message}`);
  assert.match(result.error.message, message);
  t.diagnostic(`SQLSTATE ${result.error.code}: ${result.error.message}`);
  return `${result.error.code} ${result.error.message}`;
}

function expectOk(result) {
  assert.equal(result.error, null, result.error ? `${result.error.code}: ${result.error.message}` : undefined);
  return result.data;
}

async function signedInClient(email, password) {
  const client = createClient(target.base, target.anonKey, clientOptions);
  check(await client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return client;
}

async function findUserIdByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    const match = users.find((user) => user.email === email);
    if (match) return match.id;
    if (users.length < 1000) return null;
  }
}

async function ensureFixtureWorkspaceA() {
  const existing = check(await admin.from("workspaces").select("id, owner_id, deleted_at").eq("name", FIXTURE_WORKSPACE_A), "find workspace A");
  if (existing.length > 1) throw new Error("More than one fixture workspace A exists; resolve manually");
  if (existing.length === 1) {
    const workspace = existing[0];
    if (workspace.deleted_at) throw new Error("Fixture workspace A is soft-deleted; resolve manually");
    return { id: workspace.id, ownerId: workspace.owner_id };
  }

  if (await findUserIdByEmail(FIXTURE_OWNER_EMAIL)) {
    throw new Error("owner_A exists without workspace A (interrupted bootstrap); resolve manually before running");
  }
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email: FIXTURE_OWNER_EMAIL, password, email_confirm: true }), "create owner_A");
  const owner = await signedInClient(FIXTURE_OWNER_EMAIL, password);
  const workspace = check(await owner.from("workspaces").insert({ name: FIXTURE_WORKSPACE_A, owner_id: created.user.id }).select("id").single(), "owner_A creates workspace A");
  check(await owner.from("workspace_members").insert({ workspace_id: workspace.id, user_id: created.user.id, role: "owner" }), "owner_A bootstraps owner membership");
  await owner.auth.signOut();
  return { id: workspace.id, ownerId: created.user.id };
}

async function ownerMembershipOfA() {
  return check(
    await admin.from("workspace_members").select("user_id, role, deleted_at, created_at").eq("workspace_id", ctx.workspaceA).eq("role", "owner"),
    "read owner membership of A",
  );
}

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  ctx.users[key] = { id: created.user.id, email, client: await signedInClient(email, password) };
  return ctx.users[key];
}

async function createRunWorkspace(label) {
  return check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} ${label}`, owner_id: null }).select("id").single(), `create workspace ${label}`).id;
}

async function addMember(workspaceId, userKey) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role: "member" }), `add ${userKey}`);
}

function insertEmployee(userKey, workspaceId, name, profileId) {
  return ctx.users[userKey].client
    .from("employees")
    .insert({ workspace_id: workspaceId, name: `${TAG} ${name}`, profile_id: profileId })
    .select("id, workspace_id, profile_id")
    .maybeSingle();
}

async function readEmployee(userKey, employeeId) {
  return expectOk(await ctx.users[userKey].client.from("employees").select("id, workspace_id, profile_id, phone").eq("id", employeeId).maybeSingle());
}

async function sweep(scope) {
  const employeeFilter = scope === "run" ? `${TAG} %` : `${RUN_EMPLOYEE_PREFIX}%`;
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN} %` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.workspaceA || !ctx.ownerId) throw new Error("Refusing to sweep before the workspace A fixture is identified");

  check(await admin.from("employees").delete().eq("workspace_id", ctx.workspaceA).like("name", employeeFilter), "delete run employees in A");
  check(await admin.from("workspaces").delete().like("name", workspaceFilter).neq("id", ctx.workspaceA), "delete run workspaces");
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && item.email !== FIXTURE_OWNER_EMAIL && item.id !== ctx.ownerId)) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`employee_profile_link on TEST project ${target.ref}`, { concurrency: false }, () => {
  let ownerBefore;

  before(async () => {
    if (planOnly) return;
    const fixture = await ensureFixtureWorkspaceA();
    ctx.workspaceA = fixture.id;
    ctx.ownerId = fixture.ownerId;
    ownerBefore = await ownerMembershipOfA();
    assert.equal(ownerBefore.length, 1, "workspace A must have exactly one owner membership");
    assert.equal(ownerBefore[0].user_id, ctx.ownerId);
    assert.equal(ownerBefore[0].deleted_at, null);

    await sweep("all");

    for (const key of ["member_A", "member_A2", "member_B", "stranger", "member_G"]) await createRunUser(key);
    ctx.workspaceB = await createRunWorkspace("B");
    await addMember(ctx.workspaceA, "member_A");
    await addMember(ctx.workspaceA, "member_A2");
    await addMember(ctx.workspaceA, "member_G");
    await addMember(ctx.workspaceB, "member_B");
    await addMember(ctx.workspaceB, "member_A2");
  });

  after(async () => {
    if (planOnly) return;
    let cleanupError;
    try {
      await sweep("run");
    } catch (error) {
      cleanupError = error;
    }
    if (!ctx.workspaceA || !ownerBefore) {
      if (cleanupError) throw cleanupError;
      return;
    }
    const ownerAfter = await ownerMembershipOfA();
    assert.deepEqual(ownerAfter, ownerBefore, "owner membership of workspace A must be untouched");
    const remainingMembers = check(await admin.from("workspace_members").select("user_id, role").eq("workspace_id", ctx.workspaceA), "residue members");
    const remainingEmployees = check(await admin.from("employees").select("id").eq("workspace_id", ctx.workspaceA).like("name", `${RUN_EMPLOYEE_PREFIX}%`), "residue employees");
    const remainingWorkspaces = check(await admin.from("workspaces").select("id").like("name", `${RUN_WORKSPACE_PREFIX}%`), "residue workspaces");
    const remainingUsers = [];
    for (let page = 1; ; page += 1) {
      const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "residue users");
      remainingUsers.push(...users.filter((user) => user.email?.startsWith(RUN_EMAIL_PREFIX)));
      if (users.length < 1000) break;
    }
    console.log(
      `cleanup: workspace A members=${JSON.stringify(remainingMembers.map((row) => row.role))}, run employees=${remainingEmployees.length}, run workspaces=${remainingWorkspaces.length}, run users=${remainingUsers.length}`,
    );
    if (cleanupError) throw cleanupError;
    assert.deepEqual(remainingMembers.map((row) => row.role), ["owner"]);
    assert.equal(remainingEmployees.length + remainingWorkspaces.length + remainingUsers.length, 0);
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  // A. Valid links
  it("A1 active member creates an employee with profile_id null", async () => {
    const row = expectOk(await insertEmployee("member_A", ctx.workspaceA, "A1 unlinked", null));
    assert.equal(row.profile_id, null);
    ctx.employees.A1 = row.id;
  });

  it("A2 active member links another active member of the same workspace", async () => {
    const row = expectOk(await insertEmployee("member_A", ctx.workspaceA, "A2 linked", ctx.users.member_A2.id));
    assert.equal(row.profile_id, ctx.users.member_A2.id);
    ctx.employees.A2 = row.id;
  });

  it("A3 active member links themself", async () => {
    const row = expectOk(await insertEmployee("member_A", ctx.workspaceA, "A3 self", ctx.users.member_A.id));
    assert.equal(row.profile_id, ctx.users.member_A.id);
    ctx.employees.A3 = row.id;
  });

  // B. Invalid links (removed member and deleted workspace run after F sets them up)
  it("B1 link to a member of another workspace is rejected (23514)", async (t) => {
    ctx.leak = { otherWorkspace: expectRejected(t, await insertEmployee("member_A", ctx.workspaceA, "B1", ctx.users.member_B.id), "23514", NOT_ACTIVE_MEMBER) };
  });

  it("B3 link to an existing user with no membership is rejected (23514)", async (t) => {
    ctx.leak.noMembership = expectRejected(t, await insertEmployee("member_A", ctx.workspaceA, "B3", ctx.users.stranger.id), "23514", NOT_ACTIVE_MEMBER);
  });

  it("B3b link to a user id with no Auth account is rejected identically (no existence leak, no 23503)", async (t) => {
    const ghost = expectRejected(t, await insertEmployee("member_A", ctx.workspaceA, "B3b", ghostId), "23514", NOT_ACTIVE_MEMBER);
    assert.equal(ghost, ctx.leak.otherWorkspace);
    assert.equal(ghost, ctx.leak.noMembership);
  });

  // C. Duplicate protection
  it("C1 second employee linked to the same user in the same workspace is rejected (23505)", async (t) => {
    const result = await insertEmployee("member_A", ctx.workspaceA, "C1 duplicate", ctx.users.member_A2.id);
    expectRejected(t, result, "23505", /employees_workspace_profile_unique/);
  });

  it("C2 the same user can be linked to an employee in a different workspace", async () => {
    const row = expectOk(await insertEmployee("member_B", ctx.workspaceB, "C2 other workspace", ctx.users.member_A2.id));
    assert.equal(row.profile_id, ctx.users.member_A2.id);
    ctx.employees.C2 = row.id;
  });

  // D. Workspace isolation (member_B belongs to workspace B only)
  it("D1 member of B cannot read employees of A", async () => {
    const rows = expectOk(await ctx.users.member_B.client.from("employees").select("id").eq("workspace_id", ctx.workspaceA));
    assert.deepEqual(rows, []);
  });

  it("D2 member of B updating an employee of A affects no rows and raises nothing", async () => {
    const rows = expectOk(await ctx.users.member_B.client.from("employees").update({ phone: "+37360000001", profile_id: ctx.users.member_B.id }).eq("id", ctx.employees.A2).select("id"));
    assert.deepEqual(rows, []);
    const unchanged = await readEmployee("member_A", ctx.employees.A2);
    assert.equal(unchanged.profile_id, ctx.users.member_A2.id);
    assert.equal(unchanged.phone, null);
  });

  it("D3 member of B inserting into A gets the identical RLS error for any profile_id (42501)", async (t) => {
    const outcomes = [];
    for (const [label, profileId] of [["null", null], ["A member", ctx.users.member_A.id], ["self", ctx.users.member_B.id], ["no account", ghostId]]) {
      outcomes.push(expectRejected(t, await insertEmployee("member_B", ctx.workspaceA, `D3 ${label}`, profileId), "42501", RLS_DENIED));
    }
    assert.equal(new Set(outcomes).size, 1);
  });

  // E. Existing workspace_id protection
  it("E1 changing workspace_id is rejected by employees_prevent_workspace_change (42501)", async (t) => {
    const result = await ctx.users.member_A.client.from("employees").update({ workspace_id: ctx.workspaceB }).eq("id", ctx.employees.A1).select("id");
    expectRejected(t, result, "42501", WORKSPACE_LOCKED);
    assert.equal((await readEmployee("member_A", ctx.employees.A1)).workspace_id, ctx.workspaceA);
  });

  // F. Stale membership: member_A (never the owner) is soft-deleted in A
  it("F0 setup: soft-delete member_A's membership in A (secret key, UPDATE deleted_at only)", async () => {
    const rows = check(
      await admin.from("workspace_members").update({ deleted_at: new Date().toISOString() }).eq("workspace_id", ctx.workspaceA).eq("user_id", ctx.users.member_A.id).eq("role", "member").select("user_id"),
      "soft-delete member_A",
    );
    assert.equal(rows.length, 1);
  });

  it("F1 the employee linked to the removed member remains, profile_id not cleared", async () => {
    const row = await readEmployee("member_A2", ctx.employees.A3);
    assert.equal(row?.profile_id, ctx.users.member_A.id);
  });

  it("F2 updating unrelated fields of that employee still works", async () => {
    const rows = expectOk(await ctx.users.member_A2.client.from("employees").update({ phone: "+37360000002" }).eq("id", ctx.employees.A3).select("id, phone, profile_id"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phone, "+37360000002");
    assert.equal(rows[0].profile_id, ctx.users.member_A.id);
  });

  it("F3 resubmitting the same stale profile_id still works", async () => {
    const rows = expectOk(await ctx.users.member_A2.client.from("employees").update({ profile_id: ctx.users.member_A.id, name: `${TAG} A3 self` }).eq("id", ctx.employees.A3).select("id, profile_id"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].profile_id, ctx.users.member_A.id);
  });

  it("F4 assigning another employee to the removed member is rejected (23514)", async (t) => {
    expectRejected(t, await ctx.users.member_A2.client.from("employees").update({ profile_id: ctx.users.member_A.id }).eq("id", ctx.employees.A1).select("id"), "23514", NOT_ACTIVE_MEMBER);
  });

  it("B2 a new employee linked to the soft-deleted member is rejected (23514)", async (t) => {
    const result = expectRejected(t, await insertEmployee("member_A2", ctx.workspaceA, "B2", ctx.users.member_A.id), "23514", NOT_ACTIVE_MEMBER);
    assert.equal(result, ctx.leak.otherWorkspace);
  });

  it("F5 the removed member can no longer read workspace A's employees", async () => {
    assert.deepEqual(expectOk(await ctx.users.member_A.client.from("employees").select("id").eq("workspace_id", ctx.workspaceA)), []);
  });

  // B4. Soft-deleted workspace
  it("B4 links in a soft-deleted workspace are rejected identically for any profile_id (42501)", async (t) => {
    ctx.deletedWorkspace = await createRunWorkspace("deleted");
    await addMember(ctx.deletedWorkspace, "member_A2");
    check(await admin.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", ctx.deletedWorkspace), "soft-delete run workspace");
    const outcomes = [];
    for (const [label, profileId] of [["self", ctx.users.member_A2.id], ["null", null], ["no account", ghostId]]) {
      outcomes.push(expectRejected(t, await insertEmployee("member_A2", ctx.deletedWorkspace, `B4 ${label}`, profileId), "42501", RLS_DENIED));
    }
    assert.equal(new Set(outcomes).size, 1);
  });

  // G. Account deletion
  it("G1 deleting a linked Auth account sets profile_id to null and keeps the employee", async () => {
    const row = expectOk(await insertEmployee("member_A2", ctx.workspaceA, "G1 linked", ctx.users.member_G.id));
    assert.equal(row.profile_id, ctx.users.member_G.id);
    check(await admin.auth.admin.deleteUser(ctx.users.member_G.id), "delete member_G account");
    const after = await readEmployee("member_A2", row.id);
    assert.ok(after, "employee row must remain");
    assert.equal(after.profile_id, null);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
