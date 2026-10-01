// Behavioral tests for supabase/migrations/20260929000100_workspace_member_read.sql against the
// hosted TEST project. Run explicitly with `npm run test:supabase` (reads .env.test.local).
// WORKSPACE_READ_PLAN_ONLY=1 checks the target and lists the steps without any network write.
//
// Every assertion runs as a real Auth user through the publishable (anon) key. The secret key is
// used only for setup and cleanup: creating/deleting run users and per-run workspaces, adding
// non-owner memberships, soft-deleting a non-owner membership or a per-run workspace, setting run
// users' profiles.active_workspace_id, issuing a sign-in link for owner_S, restoring fixture
// workspace S (and its run memberships) after it is soft-deleted, and deleting run data (run
// profiles go with their Auth users through the FK cascade).
//
// Persistent fixtures, each created once through the real owner flow (owner memberships cannot be
// deleted, see protect_workspace_owner):
// - owner_A (core-test+owner-a@example.com) and "core-test fixture workspace A": read-only here.
//   No write is ever aimed at A except no-op updates (same name) that RLS must reject.
// - owner_S (core-test+owner-s@example.com) and "core-test fixture workspace S": owner_S deletes S
//   through soft_delete_workspace() in S2; `after` restores S and its owner membership, so S ends
//   every run exactly as it started.
// Everything else is tagged with the run id and removed in `after`, including leftovers of
// earlier interrupted runs. No DELETE is ever sent to workspace_members.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_A_EMAIL = "core-test+owner-a@example.com";
const FIXTURE_WORKSPACE_A = "core-test fixture workspace A";
const FIXTURE_OWNER_S_EMAIL = "core-test+owner-s@example.com";
const FIXTURE_WORKSPACE_S = "core-test fixture workspace S";
const RUN_EMAIL_PREFIX = "core-test+wsread-";
const RUN_WORKSPACE_PREFIX = "core-test wsread run ";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const planOnly = process.env.WORKSPACE_READ_PLAN_ONLY === "1";

const RLS_DENIED = /^new row violates row-level security policy for table "workspaces"$/;
const TABLE_DENIED = /^permission denied for table workspaces$/;
const OWNER_ONLY_DELETE = /^Only the workspace owner can delete this workspace$/;

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

const ctx = { A: null, S: null, workspaceB: null, workspaceC: null, ownerS: null, users: {} };

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

// Setup only: returns S and its active run members to their pre-test state after a non-owner
// managed to soft-delete it, so later tests keep exercising the intended roles.
async function restoreSAfterUnauthorizedDelete() {
  await restoreFixtureS();
  const activeRunMembers = [ctx.users.a_admin.id, ctx.users.a_member.id];
  check(await admin.from("workspace_members").update({ deleted_at: null }).eq("workspace_id", ctx.S.id).in("user_id", activeRunMembers), "restore run members of S");
}

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  ctx.users[key] = { id: created.user.id, email, client: await signedInClient(email, password) };
  return ctx.users[key];
}

async function addMember(workspaceId, userKey, role) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role }), `add ${userKey} as ${role}`);
}

// Columns the app reads (membershipSelect in src/services/apiWorkspaces.ts with every optional column).
const WORKSPACE_COLUMNS = ["id", "name", "owner_id", "deleted_at", "industry_id", "avatar_path", "inventory_markup", "language", "timezone", "date_format", "currency"];
const APP_MEMBERSHIP_SELECT = `role,
  workspaces!inner (
    ${WORKSPACE_COLUMNS.join(",\n    ")},
    industry:industries (
      id,
      name,
      slug
    )
  )`;

function selectWorkspace(client, workspaceId) {
  return client.from("workspaces").select(WORKSPACE_COLUMNS.join(", ")).eq("id", workspaceId);
}

// getUserWorkspaces()
function selectMyWorkspaces(user) {
  return user.client.from("workspace_members").select(APP_MEMBERSHIP_SELECT).eq("user_id", user.id).is("deleted_at", null).is("workspaces.deleted_at", null);
}

// getWorkspace(workspaceId)
function selectMyWorkspace(user, workspaceId) {
  return user.client
    .from("workspace_members")
    .select(APP_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("workspaces.deleted_at", null)
    .maybeSingle();
}

function listsWorkspace(rows, workspaceId) {
  return rows.some((row) => row.workspaces?.id === workspaceId);
}

function pick(record, keys) {
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

async function setActiveWorkspaceId(userKey, workspaceId) {
  check(await admin.from("profiles").upsert({ id: ctx.users[userKey].id, email: ctx.users[userKey].email, active_workspace_id: workspaceId }), `setup: profile of ${userKey}`);
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

describe(`workspace_member_read on TEST project ${target.ref}`, { concurrency: false }, () => {
  let ownerABefore;
  let ownerSBefore;
  let workspaceABefore;
  let profileCountBefore;

  before(async () => {
    if (planOnly) return;
    ctx.A = await ensureOwnedFixture(FIXTURE_OWNER_A_EMAIL, FIXTURE_WORKSPACE_A);
    if (ctx.A.deletedAt) throw new Error("Fixture workspace A is soft-deleted; resolve manually");
    ownerABefore = await ownerMembership(ctx.A);
    assert.equal(ownerABefore.length, 1, "workspace A must have exactly one owner membership");
    assert.equal(ownerABefore[0].user_id, ctx.A.ownerId);
    assert.equal(ownerABefore[0].deleted_at, null);
    workspaceABefore = check(await admin.from("workspaces").select("*").eq("id", ctx.A.id).single(), "snapshot workspace A");

    ctx.S = await ensureOwnedFixture(FIXTURE_OWNER_S_EMAIL, FIXTURE_WORKSPACE_S);
    await sweep("all");
    ownerSBefore = await ownerMembership(ctx.S);
    assert.equal(ownerSBefore.length, 1, "workspace S must have exactly one owner membership");
    assert.equal(ownerSBefore[0].user_id, ctx.S.ownerId);
    assert.equal(ownerSBefore[0].deleted_at, null);
    profileCountBefore = (await admin.from("profiles").select("id", { count: "exact", head: true })).count;

    for (const key of ["a_admin", "a_manager", "a_member", "b_member", "stranger", "creator"]) await createRunUser(key);
    ctx.workspaceB = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} B`, owner_id: null }).select("id").single(), "create workspace B").id;
    await addMember(ctx.A.id, "a_admin", "admin");
    await addMember(ctx.A.id, "a_manager", "manager");
    await addMember(ctx.A.id, "a_member", "member");
    await addMember(ctx.workspaceB, "b_member", "member");
    await addMember(ctx.S.id, "a_admin", "admin");
    await addMember(ctx.S.id, "a_member", "member");
    check(await admin.from("workspace_members").insert({ workspace_id: ctx.S.id, user_id: ctx.users.a_manager.id, role: "member", deleted_at: new Date().toISOString() }), "add a_manager as removed member of S");
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
    const ownerSAfter = await ownerMembership(ctx.S);
    const workspaceAAfter = check(await admin.from("workspaces").select("*").eq("id", ctx.A.id).single(), "workspace A after");
    const [workspaceSAfter] = check(await admin.from("workspaces").select("deleted_at").eq("id", ctx.S.id), "workspace S after");
    const membersA = check(await admin.from("workspace_members").select("role").eq("workspace_id", ctx.A.id), "residue members A");
    const membersS = check(await admin.from("workspace_members").select("role").eq("workspace_id", ctx.S.id), "residue members S");
    const remainingWorkspaces = check(await admin.from("workspaces").select("id").like("name", `${RUN_WORKSPACE_PREFIX}%`), "residue workspaces");
    const profileCountAfter = (await admin.from("profiles").select("id", { count: "exact", head: true })).count;
    const remainingUsers = [];
    for (let page = 1; ; page += 1) {
      const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "residue users");
      remainingUsers.push(...users.filter((user) => user.email?.startsWith(RUN_EMAIL_PREFIX)));
      if (users.length < 1000) break;
    }
    console.log(
      `cleanup: workspace A members=${JSON.stringify(membersA.map((row) => row.role))}, workspace S members=${JSON.stringify(membersS.map((row) => row.role))}, workspace S deleted_at=${workspaceSAfter?.deleted_at}, run workspaces=${remainingWorkspaces.length}, run users=${remainingUsers.length}, profiles before/after=${profileCountBefore}/${profileCountAfter}`,
    );
    if (cleanupError) throw cleanupError;
    assert.equal(profileCountAfter, profileCountBefore, "run profiles must be removed with their users");
    assert.deepEqual(ownerAAfter, ownerABefore, "owner membership of workspace A must be untouched");
    assert.deepEqual(workspaceAAfter, workspaceABefore, "workspace A row must be untouched");
    assert.deepEqual(ownerSAfter, ownerSBefore, "owner membership of workspace S must be restored exactly");
    assert.equal(workspaceSAfter.deleted_at, null, "workspace S must be restored");
    assert.deepEqual(membersA.map((row) => row.role), ["owner"]);
    assert.deepEqual(membersS.map((row) => row.role), ["owner"]);
    assert.equal(remainingWorkspaces.length + remainingUsers.length, 0);
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  // R. Read access
  for (const key of ["a_admin", "a_manager", "a_member"]) {
    it(`R1 non-owner ${key} reads workspace A directly (all app columns, and the getInventoryMarkup query)`, async () => {
      const rows = expectOk(await selectWorkspace(ctx.users[key].client, ctx.A.id));
      assert.equal(rows.length, 1, "active member must see their workspace");
      assert.deepEqual(rows[0], pick(workspaceABefore, WORKSPACE_COLUMNS));
      const markup = expectOk(await ctx.users[key].client.from("workspaces").select("inventory_markup").eq("id", ctx.A.id).maybeSingle());
      assert.deepEqual(markup, { inventory_markup: workspaceABefore.inventory_markup });
    });
  }

  for (const [key, role] of [["a_admin", "admin"], ["a_manager", "manager"], ["a_member", "member"]]) {
    it(`R2 non-owner ${key} gets workspace A through the app's getUserWorkspaces and getWorkspace queries (workspace_members + workspaces!inner)`, async () => {
      const user = ctx.users[key];
      const listed = expectOk(await selectMyWorkspaces(user)).find((row) => row.workspaces?.id === ctx.A.id);
      assert.ok(listed, "workspace A must be listed by getUserWorkspaces");
      assert.equal(listed.role, role);
      const single = expectOk(await selectMyWorkspace(user, ctx.A.id));
      assert.ok(single, "getWorkspace(A) must return the membership");
      assert.equal(single.role, role);
      const { industry, ...workspace } = single.workspaces;
      assert.deepEqual(workspace, pick(workspaceABefore, WORKSPACE_COLUMNS));
      assert.equal(industry?.id ?? null, workspaceABefore.industry_id);
    });
  }

  it("R3 member of B only cannot read workspace A (direct, list and single queries)", async () => {
    const user = ctx.users.b_member;
    assert.deepEqual(expectOk(await selectWorkspace(user.client, ctx.A.id)), []);
    assert.equal(listsWorkspace(expectOk(await selectMyWorkspaces(user)), ctx.A.id), false);
    assert.equal(expectOk(await selectMyWorkspace(user, ctx.A.id)), null);
  });

  it("R6 user with no membership reads nothing; anonymous request is denied (42501)", async (t) => {
    assert.deepEqual(expectOk(await selectWorkspace(ctx.users.stranger.client, ctx.A.id)), []);
    assert.deepEqual(expectOk(await ctx.users.stranger.client.from("workspaces").select("id")), [], "no workspace is visible at all");
    expectRejected(t, await selectWorkspace(anonClient(), ctx.A.id), "42501", TABLE_DENIED);
  });

  it("R7a profiles.active_workspace_id pointing at A grants a non-member nothing", async () => {
    await setActiveWorkspaceId("stranger", ctx.A.id);
    const user = ctx.users.stranger;
    assert.deepEqual(expectOk(await selectWorkspace(user.client, ctx.A.id)), []);
    assert.equal(expectOk(await selectMyWorkspace(user, ctx.A.id)), null);
  });

  it("R7b a member whose active_workspace_id points elsewhere still reads A and still cannot read the other workspace", async () => {
    await setActiveWorkspaceId("a_member", ctx.workspaceB);
    const user = ctx.users.a_member;
    assert.equal(expectOk(await selectWorkspace(user.client, ctx.A.id)).length, 1, "membership alone grants read access to A");
    assert.deepEqual(expectOk(await selectWorkspace(user.client, ctx.workspaceB)), [], "active_workspace_id alone grants nothing on B");
  });

  it("R4 removed (soft-deleted) member of A can no longer read workspace A", async () => {
    const rows = check(
      await admin.from("workspace_members").update({ deleted_at: new Date().toISOString() }).eq("workspace_id", ctx.A.id).eq("user_id", ctx.users.a_manager.id).eq("role", "manager").select("user_id"),
      "setup: soft-delete a_manager in A",
    );
    assert.equal(rows.length, 1);
    const user = ctx.users.a_manager;
    assert.deepEqual(expectOk(await selectWorkspace(user.client, ctx.A.id)), []);
    assert.equal(listsWorkspace(expectOk(await selectMyWorkspaces(user)), ctx.A.id), false);
    assert.equal(expectOk(await selectMyWorkspace(user, ctx.A.id)), null);
  });

  it("R5 a soft-deleted workspace is unreadable even while the member's own membership row is still active", async () => {
    ctx.workspaceD = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} D`, owner_id: null }).select("id").single(), "setup: create workspace D").id;
    await addMember(ctx.workspaceD, "b_member", "member");
    check(await admin.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", ctx.workspaceD), "setup: soft-delete workspace D only");
    const user = ctx.users.b_member;
    const ownRow = expectOk(await user.client.from("workspace_members").select("user_id").eq("workspace_id", ctx.workspaceD).eq("user_id", user.id));
    assert.equal(ownRow.length, 1, "precondition: the membership itself is still active");
    assert.deepEqual(expectOk(await selectWorkspace(user.client, ctx.workspaceD)), []);
    assert.equal(listsWorkspace(expectOk(await selectMyWorkspaces(user)), ctx.workspaceD), false);
    assert.equal(expectOk(await selectMyWorkspace(user, ctx.workspaceD)), null);
  });

  // W. Writes stay owner-only (INSERT/UPDATE by owner_id, no DELETE grant)
  it("W3 authenticated user creates a workspace with owner_id = self and reads it back", async () => {
    const row = expectOk(await ctx.users.creator.client.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} C`, owner_id: ctx.users.creator.id }).select("id, owner_id").single());
    assert.equal(row.owner_id, ctx.users.creator.id);
    ctx.workspaceC = row.id;
    await addMember(ctx.workspaceC, "a_member", "member");
  });

  it("W3b creating a workspace owned by another user is rejected (42501)", async (t) => {
    const result = await ctx.users.creator.client.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} C foreign`, owner_id: ctx.users.stranger.id }).select("id");
    expectRejected(t, result, "42501", RLS_DENIED);
  });

  it("W1 non-owner members cannot update the workspace through any app update shape (no rows, no error, data unchanged)", async () => {
    // Values equal A's current ones, so even a wrongly permitted update could not change A.
    const updates = {
      details: pick(workspaceABefore, ["name", "industry_id", "inventory_markup"]),
      preferences: pick(workspaceABefore, ["language", "timezone", "date_format", "currency"]),
      avatar: pick(workspaceABefore, ["avatar_path"]),
    };
    for (const key of ["a_admin", "a_member"]) {
      for (const [shape, fields] of Object.entries(updates)) {
        assert.deepEqual(expectOk(await ctx.users[key].client.from("workspaces").update(fields).eq("id", ctx.A.id).select("id")), [], `${key} ${shape} update on A`);
      }
    }
    const attempt = `${RUN_WORKSPACE_PREFIX}${RUN} C member-edit`;
    assert.deepEqual(expectOk(await ctx.users.a_member.client.from("workspaces").update({ name: attempt }).eq("id", ctx.workspaceC).select("id")), []);
    const [rowC] = expectOk(await selectWorkspace(ctx.users.creator.client, ctx.workspaceC));
    assert.equal(rowC.name, `${RUN_WORKSPACE_PREFIX}${RUN} C`);
  });

  it("W2 owner_id user updates their workspace details", async () => {
    const renamed = `${RUN_WORKSPACE_PREFIX}${RUN} C renamed`;
    const rows = expectOk(await ctx.users.creator.client.from("workspaces").update({ name: renamed }).eq("id", ctx.workspaceC).select("id, name"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, renamed);
  });

  it("W4 direct UPDATE of deleted_at is not a deletion route: member gets no rows, owner is rejected (42501)", async (t) => {
    const now = new Date().toISOString();
    assert.deepEqual(expectOk(await ctx.users.a_member.client.from("workspaces").update({ deleted_at: now }).eq("id", ctx.workspaceC).select("id")), []);
    expectRejected(t, await ctx.users.creator.client.from("workspaces").update({ deleted_at: now }).eq("id", ctx.workspaceC).select("id"), "42501", RLS_DENIED);
    const rows = expectOk(await selectWorkspace(ctx.users.creator.client, ctx.workspaceC));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].deleted_at, null);
  });

  it("W5 DELETE on workspaces is denied to authenticated users (42501)", async (t) => {
    expectRejected(t, await ctx.users.creator.client.from("workspaces").delete().eq("id", ctx.workspaceC).select("id"), "42501", TABLE_DENIED);
    assert.equal(expectOk(await selectWorkspace(ctx.users.creator.client, ctx.workspaceC)).length, 1);
  });

  // S. Deletion goes through soft_delete_workspace(), owner only
  it("S0 active non-owner members of S read workspace S before deletion", async () => {
    for (const key of ["a_admin", "a_member"]) {
      assert.equal(expectOk(await selectWorkspace(ctx.users[key].client, ctx.S.id)).length, 1, `${key} must see S`);
    }
  });

  for (const [key, description] of [
    ["a_admin", "admin of S"],
    ["a_member", "member of S"],
    ["a_manager", "removed member of S"],
    ["b_member", "member of another workspace only"],
    ["stranger", "user with no membership"],
  ]) {
    it(`S1 soft_delete_workspace(S) by ${key} (${description}) is rejected (42501) and S stays active`, async (t) => {
      const result = await ctx.users[key].client.rpc("soft_delete_workspace", { target_workspace: ctx.S.id });
      const stillActive = expectOk(await selectWorkspace(ctx.ownerS, ctx.S.id)).length === 1;
      if (!stillActive) await restoreSAfterUnauthorizedDelete();
      assert.equal(stillActive, true, `${key} soft-deleted workspace S (rpc error: ${result.error ? `${result.error.code} ${result.error.message}` : "none"})`);
      expectRejected(t, result, "42501", OWNER_ONLY_DELETE);
    });
  }

  it("S2 owner soft-deletes S through soft_delete_workspace(); nobody can read S afterwards", async () => {
    assert.equal(expectOk(await selectWorkspace(ctx.ownerS, ctx.S.id)).length, 1, "S must be active before the owner deletes it");
    expectOk(await ctx.ownerS.rpc("soft_delete_workspace", { target_workspace: ctx.S.id }));
    for (const [label, client] of [["owner_S", ctx.ownerS], ["a_admin", ctx.users.a_admin.client], ["a_member", ctx.users.a_member.client]]) {
      assert.deepEqual(expectOk(await selectWorkspace(client, ctx.S.id)), [], `${label} must not see deleted S`);
    }
    for (const key of ["a_admin", "a_member"]) {
      assert.equal(listsWorkspace(expectOk(await selectMyWorkspaces(ctx.users[key])), ctx.S.id), false, `${key} membership list must not include deleted S`);
    }
    const ownerMemberships = expectOk(await ctx.ownerS.from("workspace_members").select("workspace_id").eq("workspace_id", ctx.S.id));
    assert.deepEqual(ownerMemberships, [], "owner_S membership in S is soft-deleted");
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
