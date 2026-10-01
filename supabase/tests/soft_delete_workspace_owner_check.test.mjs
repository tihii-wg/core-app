// Behavioral tests for supabase/migrations/20260929000050_soft_delete_workspace_owner_check.sql
// against the hosted TEST project. Run explicitly with `npm run test:supabase` (reads .env.test.local).
// SOFT_DELETE_PLAN_ONLY=1 checks the target and lists the steps without any network write.
//
// Every call to soft_delete_workspace() and every visibility check runs as a real Auth user (or
// anonymously) through the publishable key. The secret key is used only for setup and cleanup:
// creating/deleting run users and a per-run workspace, adding non-owner memberships (one of them
// already soft-deleted), issuing a sign-in link for owner_S, restoring fixture workspace S and its
// run memberships after it is soft-deleted, and deleting run data.
//
// Persistent fixtures (owner memberships cannot be deleted, see protect_workspace_owner):
// - owner_A and "core-test fixture workspace A": never targeted; only read to prove they are untouched.
// - owner_S (core-test+owner-s@example.com) and "core-test fixture workspace S": the target. `after`
//   restores S and its owner membership, so S ends every run exactly as it started.
// No DELETE is ever sent to workspace_members.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_A_EMAIL = "core-test+owner-a@example.com";
const FIXTURE_WORKSPACE_A = "core-test fixture workspace A";
const FIXTURE_OWNER_S_EMAIL = "core-test+owner-s@example.com";
const FIXTURE_WORKSPACE_S = "core-test fixture workspace S";
const RUN_EMAIL_PREFIX = "core-test+softdel-";
const RUN_WORKSPACE_PREFIX = "core-test softdel run ";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const planOnly = process.env.SOFT_DELETE_PLAN_ONLY === "1";

const OWNER_ONLY_DELETE = /^Only the workspace owner can delete this workspace$/;
const FUNCTION_DENIED = /^permission denied for function soft_delete_workspace$/;
const ACTIVE_S_MEMBERS = ["s_admin", "s_manager", "s_member"];

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

const ctx = { A: null, S: null, workspaceB: null, ownerS: null, users: {} };

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

function describeError(result) {
  return result.error ? `${result.error.code} ${result.error.message}` : "none";
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

async function findUserIdByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    const match = users.find((user) => user.email === email);
    if (match) return match.id;
    if (users.length < 1000) return null;
  }
}

async function ensureOwnedFixture(email, name) {
  const existing = check(await admin.from("workspaces").select("id, owner_id, deleted_at").eq("name", name), `find ${name}`);
  if (existing.length > 1) throw new Error(`More than one "${name}" exists; resolve manually`);
  if (existing.length === 1) return { id: existing[0].id, ownerId: existing[0].owner_id, deletedAt: existing[0].deleted_at };

  if (await findUserIdByEmail(email)) throw new Error(`${email} exists without "${name}" (interrupted bootstrap); resolve manually before running`);
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${email}`);
  const owner = await signedInClient(email, password);
  const workspace = check(await owner.from("workspaces").insert({ name, owner_id: created.user.id }).select("id").single(), `${email} creates "${name}"`);
  check(await owner.from("workspace_members").insert({ workspace_id: workspace.id, user_id: created.user.id, role: "owner" }), `${email} bootstraps owner membership`);
  await owner.auth.signOut();
  return { id: workspace.id, ownerId: created.user.id, deletedAt: null };
}

async function ownerMembership(workspace) {
  return check(
    await admin.from("workspace_members").select("user_id, role, deleted_at, created_at").eq("workspace_id", workspace.id).eq("role", "owner"),
    "read owner membership",
  );
}

// protect_workspace_owner only lets the owner membership's deleted_at change while the workspace
// itself is soft-deleted, so the membership is restored first.
async function restoreFixtureS() {
  const [workspace] = check(await admin.from("workspaces").select("deleted_at").eq("id", ctx.S.id), "read workspace S");
  const owners = await ownerMembership(ctx.S);
  if (owners.length !== 1 || owners[0].user_id !== ctx.S.ownerId) throw new Error("Workspace S owner membership is inconsistent; resolve manually");
  if (owners[0].deleted_at) {
    if (!workspace.deleted_at) {
      check(await admin.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", ctx.S.id), "re-mark workspace S deleted");
    }
    check(await admin.from("workspace_members").update({ deleted_at: null }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).eq("role", "owner"), "restore owner_S membership");
  }
  check(await admin.from("workspaces").update({ deleted_at: null }).eq("id", ctx.S.id).not("deleted_at", "is", null), "restore workspace S");
}

// Setup only: returns S and its active run members to their pre-test state after an unauthorized
// soft-delete, so every later case still targets the intended state.
async function restoreSAfterUnauthorizedDelete() {
  await restoreFixtureS();
  const activeRunMembers = ACTIVE_S_MEMBERS.map((key) => ctx.users[key].id);
  check(await admin.from("workspace_members").update({ deleted_at: null }).eq("workspace_id", ctx.S.id).in("user_id", activeRunMembers), "restore run members of S");
}

async function restoreBAfterUnauthorizedDelete() {
  check(await admin.from("workspaces").update({ deleted_at: null }).eq("id", ctx.workspaceB), "restore workspace B");
  check(await admin.from("workspace_members").update({ deleted_at: null }).eq("workspace_id", ctx.workspaceB), "restore members of B");
}

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  ctx.users[key] = { id: created.user.id, email, client: await signedInClient(email, password) };
  return ctx.users[key];
}

async function addMember(workspaceId, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} as ${role}`);
}

function softDelete(client, workspaceId) {
  return client.rpc("soft_delete_workspace", { target_workspace: workspaceId });
}

// owner_S sees S only while it is active ("Owners can view active workspace").
async function ownerSeesS() {
  return expectOk(await ctx.ownerS.from("workspaces").select("id").eq("id", ctx.S.id)).length === 1;
}

// A user's own membership row is visible to them only while its deleted_at is null (team_members_select).
async function ownMembershipActive(client, userId, workspaceId) {
  return expectOk(await client.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId)).length === 1;
}

async function assertSUntouched() {
  assert.equal(await ownerSeesS(), true, "workspace S must still be active");
  assert.equal(await ownMembershipActive(ctx.ownerS, ctx.S.ownerId, ctx.S.id), true, "owner_S membership must still be active");
  for (const key of ACTIVE_S_MEMBERS) {
    assert.equal(await ownMembershipActive(ctx.users[key].client, ctx.users[key].id, ctx.S.id), true, `${key} membership in S must still be active`);
  }
}

async function sweep(scope) {
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN} %` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.A?.id || !ctx.A.ownerId || !ctx.S?.id || !ctx.S.ownerId) throw new Error("Refusing to sweep before fixtures A and S are identified");
  const fixtureEmails = new Set([FIXTURE_OWNER_A_EMAIL, FIXTURE_OWNER_S_EMAIL]);
  const fixtureOwners = new Set([ctx.A.ownerId, ctx.S.ownerId]);

  check(await admin.from("workspaces").delete().like("name", workspaceFilter).neq("id", ctx.A.id).neq("id", ctx.S.id), "delete run workspaces");
  await restoreFixtureS();
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && !fixtureEmails.has(item.email) && !fixtureOwners.has(item.id))) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`soft_delete_workspace owner check on TEST project ${target.ref}`, { concurrency: false }, () => {
  let ownerABefore;
  let workspaceABefore;
  let ownerSBefore;

  before(async () => {
    if (planOnly) return;
    const existingA = check(await admin.from("workspaces").select("id, owner_id, deleted_at").eq("name", FIXTURE_WORKSPACE_A), "find workspace A");
    if (existingA.length !== 1 || existingA[0].deleted_at) throw new Error("Fixture workspace A must exist exactly once and be active");
    ctx.A = { id: existingA[0].id, ownerId: existingA[0].owner_id };
    ownerABefore = await ownerMembership(ctx.A);
    workspaceABefore = check(await admin.from("workspaces").select("*").eq("id", ctx.A.id).single(), "snapshot workspace A");

    ctx.S = await ensureOwnedFixture(FIXTURE_OWNER_S_EMAIL, FIXTURE_WORKSPACE_S);
    await sweep("all");
    ownerSBefore = await ownerMembership(ctx.S);
    assert.equal(ownerSBefore.length, 1, "workspace S must have exactly one owner membership");
    assert.equal(ownerSBefore[0].user_id, ctx.S.ownerId);
    assert.equal(ownerSBefore[0].deleted_at, null);

    for (const key of ["s_admin", "s_manager", "s_member", "s_removed", "b_member", "stranger"]) await createRunUser(key);
    ctx.workspaceB = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} B`, owner_id: null }).select("id").single(), "create workspace B").id;
    await addMember(ctx.S.id, "s_admin", "admin");
    await addMember(ctx.S.id, "s_manager", "manager");
    await addMember(ctx.S.id, "s_member", "member");
    await addMember(ctx.S.id, "s_removed", "member", new Date().toISOString());
    await addMember(ctx.workspaceB, "b_member", "member");
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
    if (!ownerABefore || !ownerSBefore) {
      if (cleanupError) throw cleanupError;
      return;
    }
    const ownerAAfter = await ownerMembership(ctx.A);
    const workspaceAAfter = check(await admin.from("workspaces").select("*").eq("id", ctx.A.id).single(), "workspace A after");
    const ownerSAfter = await ownerMembership(ctx.S);
    const [workspaceSAfter] = check(await admin.from("workspaces").select("deleted_at").eq("id", ctx.S.id), "workspace S after");
    const membersA = check(await admin.from("workspace_members").select("role").eq("workspace_id", ctx.A.id), "residue members A");
    const membersS = check(await admin.from("workspace_members").select("role").eq("workspace_id", ctx.S.id), "residue members S");
    const remainingWorkspaces = check(await admin.from("workspaces").select("id").like("name", `${RUN_WORKSPACE_PREFIX}%`), "residue workspaces");
    const remainingUsers = [];
    for (let page = 1; ; page += 1) {
      const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "residue users");
      remainingUsers.push(...users.filter((user) => user.email?.startsWith(RUN_EMAIL_PREFIX)));
      if (users.length < 1000) break;
    }
    console.log(
      `cleanup: workspace A members=${JSON.stringify(membersA.map((row) => row.role))}, workspace S members=${JSON.stringify(membersS.map((row) => row.role))}, workspace S deleted_at=${workspaceSAfter?.deleted_at}, run workspaces=${remainingWorkspaces.length}, run users=${remainingUsers.length}`,
    );
    if (cleanupError) throw cleanupError;
    assert.deepEqual(ownerAAfter, ownerABefore, "owner membership of workspace A must be untouched");
    assert.deepEqual(workspaceAAfter, workspaceABefore, "workspace A row must be untouched");
    assert.deepEqual(ownerSAfter, ownerSBefore, "owner membership of workspace S must be restored exactly");
    assert.equal(workspaceSAfter.deleted_at, null, "workspace S must be restored");
    assert.deepEqual(membersA.map((row) => row.role), ["owner"]);
    assert.deepEqual(membersS.map((row) => row.role), ["owner"]);
    assert.equal(remainingWorkspaces.length + remainingUsers.length, 0);
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  it("setup sanity: S is active and every active member of S sees their own membership", async () => {
    await assertSUntouched();
    assert.equal(await ownMembershipActive(ctx.users.s_removed.client, ctx.users.s_removed.id, ctx.S.id), false, "s_removed starts removed");
  });

  // Owner membership stays protected from direct writes (UPDATE only; DELETE is never attempted).
  it("P1 admin of S cannot soft-delete or re-role the owner membership (no rows)", async () => {
    const client = ctx.users.s_admin.client;
    assert.deepEqual(expectOk(await client.from("workspace_members").update({ deleted_at: new Date().toISOString() }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).select("user_id")), []);
    assert.deepEqual(expectOk(await client.from("workspace_members").update({ role: "member" }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).select("user_id")), []);
    await assertSUntouched();
  });

  it("P2 owner_S cannot soft-delete or re-role their own owner membership directly (no rows)", async () => {
    assert.deepEqual(expectOk(await ctx.ownerS.from("workspace_members").update({ deleted_at: new Date().toISOString() }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).select("user_id")), []);
    assert.deepEqual(expectOk(await ctx.ownerS.from("workspace_members").update({ role: "admin" }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).select("user_id")), []);
    await assertSUntouched();
  });

  // Rejected callers: each must get 42501 and leave S and every membership untouched.
  for (const [label, key, description] of [
    ["B", "s_admin", "admin of S"],
    ["B2", "s_manager", "manager of S"],
    ["C", "s_member", "member of S"],
    ["D", "stranger", "non-member"],
    ["E", "b_member", "member of another workspace"],
    ["F", "s_removed", "deleted member of S"],
  ]) {
    it(`${label} ${description} (${key}) -> soft_delete_workspace(S) is rejected (42501); S untouched`, async (t) => {
      const result = await softDelete(ctx.users[key].client, ctx.S.id);
      const untouched = (await ownerSeesS()) && (await ownMembershipActive(ctx.ownerS, ctx.S.ownerId, ctx.S.id));
      if (!untouched) await restoreSAfterUnauthorizedDelete();
      assert.equal(untouched, true, `${key} soft-deleted workspace S (rpc error: ${describeError(result)})`);
      expectRejected(t, result, "42501", OWNER_ONLY_DELETE);
      await assertSUntouched();
    });
  }

  it("E2 owner of S -> soft_delete_workspace(B), a workspace they do not belong to, is rejected (42501); B untouched", async (t) => {
    const result = await softDelete(ctx.ownerS, ctx.workspaceB);
    const untouched = await ownMembershipActive(ctx.users.b_member.client, ctx.users.b_member.id, ctx.workspaceB);
    if (!untouched) await restoreBAfterUnauthorizedDelete();
    assert.equal(untouched, true, `owner_S soft-deleted workspace B (rpc error: ${describeError(result)})`);
    expectRejected(t, result, "42501", OWNER_ONLY_DELETE);
  });

  it("I soft_delete_workspace() on a nonexistent workspace id is rejected (42501)", async (t) => {
    expectRejected(t, await softDelete(ctx.users.stranger.client, randomUUID()), "42501", OWNER_ONLY_DELETE);
  });

  it("J anonymous caller has no EXECUTE on soft_delete_workspace (42501)", async (t) => {
    expectRejected(t, await softDelete(anonClient(), ctx.S.id), "42501", FUNCTION_DENIED);
    await assertSUntouched();
  });

  // A/H. Owner deletes their own active workspace
  it("A/H owner_S -> soft_delete_workspace(S) succeeds; S and all of its memberships are soft-deleted", async () => {
    await assertSUntouched();
    expectOk(await softDelete(ctx.ownerS, ctx.S.id));
    assert.equal(await ownerSeesS(), false, "S must be soft-deleted");
    assert.equal(await ownMembershipActive(ctx.ownerS, ctx.S.ownerId, ctx.S.id), false, "owner membership is soft-deleted as designed");
    for (const key of ACTIVE_S_MEMBERS) {
      assert.equal(await ownMembershipActive(ctx.users[key].client, ctx.users[key].id, ctx.S.id), false, `${key} membership must be soft-deleted`);
    }
  });

  // G. Already soft-deleted workspace
  it("G soft_delete_workspace() on the already soft-deleted S is rejected (42501) for the owner and a former admin", async (t) => {
    expectRejected(t, await softDelete(ctx.ownerS, ctx.S.id), "42501", OWNER_ONLY_DELETE);
    expectRejected(t, await softDelete(ctx.users.s_admin.client, ctx.S.id), "42501", OWNER_ONLY_DELETE);
  });

  it("P3 after deletion the owner membership still cannot be changed directly by the former owner (no rows)", async () => {
    assert.deepEqual(expectOk(await ctx.ownerS.from("workspace_members").update({ deleted_at: null }).eq("workspace_id", ctx.S.id).eq("user_id", ctx.S.ownerId).select("user_id")), []);
    assert.equal(await ownMembershipActive(ctx.ownerS, ctx.S.ownerId, ctx.S.id), false);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
