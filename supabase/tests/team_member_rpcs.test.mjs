// Behavioral tests for supabase/migrations/20260929000300_team_member_rpcs.sql against the hosted
// TEST project. Run explicitly (reads .env.test.local); TEAM_PLAN_ONLY=1 checks the target and
// lists the steps without any network request.
//
// Every call under test runs as a real Auth user (or anonymously) through the publishable key. The
// secret key is used only for setup and cleanup: creating/deleting run users and their profiles,
// per-run workspaces B and D, non-owner memberships (one already removed), soft-deleting D,
// issuing a sign-in link for owner_S, and snapshotting.
//
// Persistent fixtures (never modified here):
// - owner_A and "core-test fixture workspace A": only read, to prove they are untouched.
// - owner_S (core-test+owner-s@example.com) and "core-test fixture workspace S": run users join S
//   as non-owner members; the workspace row, its owner membership and owner_S's profile are never
//   written. Run memberships in S disappear with their Auth users (ON DELETE CASCADE).
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
const RUN_EMAIL_PREFIX = "core-test+team-";
const RUN_WORKSPACE_PREFIX = "core-test team run ";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `core-test-team-${RUN}`;
const planOnly = process.env.TEAM_PLAN_ONLY === "1";

const NO_ACCESS = /^You do not have access to this workspace$/;
const NO_PERMISSION = /^You do not have permission to add team members$/;
const DUPLICATE_MEMBER = /^duplicate key value violates unique constraint "workspace_members_/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTED_TABLES = ["workspaces", "workspace_members", "profiles", "employees"];
const RUN_USERS = ["s_admin", "s_manager", "s_member", "s_removed", "both", "b_admin", "d_admin", "stranger", "newbie"];
const WITHOUT_PROFILE = new Set(["both"]);

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

const ctx = { A: null, S: null, workspaceB: null, workspaceD: null, ownerS: null, ownerSUser: null, users: {} };

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? ""} ${result.error.message}`);
  return result.data;
}

function expectRejected(t, result, code, message) {
  assert.ok(result.error, `expected SQLSTATE ${code}, the call succeeded with ${JSON.stringify(result.data)}`);
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

async function profileOf(userId) {
  return check(await admin.from("profiles").select("*").eq("id", userId).maybeSingle(), "read profile");
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
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key.replace(/_/g, "-")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  const fullName = WITHOUT_PROFILE.has(key) ? null : `${TAG} ${key}`;
  if (fullName) {
    check(await admin.from("profiles").insert({ id: created.user.id, full_name: fullName, email, active_workspace_id: null }), `create profile ${key}`);
  }
  ctx.users[key] = { id: created.user.id, email, fullName, client: await signedInClient(email, password) };
}

async function addMember(workspaceId, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} as ${role}`);
}

async function createRunWorkspace(label) {
  return check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} ${label}`, owner_id: null }).select("id").single(), `create workspace ${label}`).id;
}

function clientOf(key) {
  if (key === "owner_S") return ctx.ownerS;
  if (key === "anon") return anonClient();
  return ctx.users[key].client;
}

function listMembers(key, workspaceId) {
  return clientOf(key).rpc("workspace_member_profiles", { target_workspace: workspaceId });
}

function findUser(key, workspaceId, email) {
  return clientOf(key).rpc("workspace_member_find_user", { target_workspace: workspaceId, member_email: email });
}

function expectedRow(key) {
  if (key === "owner_S") return ctx.ownerSUser;
  const user = ctx.users[key];
  return { user_id: user.id, full_name: user.fullName, email: user.email };
}

function byUserId(rows) {
  return [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id));
}

function assertMembers(rows, keys, label) {
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["email", "full_name", "user_id"], `${label}: only user_id, full_name and email are returned`);
  assert.deepEqual(byUserId(rows), byUserId(keys.map(expectedRow)), label);
}

async function sweep(scope) {
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN} %` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.A?.id || !ctx.S?.id) throw new Error("Refusing to sweep before fixtures A and S are identified");
  const fixtureEmails = new Set([FIXTURE_OWNER_A_EMAIL, FIXTURE_OWNER_S_EMAIL]);
  const fixtureOwners = new Set([ctx.A.owner_id, ctx.S.owner_id]);

  // Run workspaces have no owner membership; their memberships cascade with them.
  check(await admin.from("workspaces").delete().like("name", workspaceFilter).neq("id", ctx.A.id).neq("id", ctx.S.id), "delete run workspaces");
  // Profiles and the remaining run memberships (in S) cascade with their Auth users.
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && !fixtureEmails.has(item.email) && !fixtureOwners.has(item.id))) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`team_member_rpcs on TEST project ${target.ref}`, { concurrency: false }, () => {
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
    assert.equal(snapshot.ownerS[0].deleted_at, null);
    const ownerSId = snapshot.ownerS[0].user_id;
    snapshot.ownerSProfile = await profileOf(ownerSId);
    const ownerSAuth = check(await admin.auth.admin.getUserById(ownerSId), "read owner_S account").user;
    assert.equal(ownerSAuth.email, FIXTURE_OWNER_S_EMAIL, "the owner membership of S must belong to owner_S");
    ctx.ownerSUser = { user_id: ownerSId, full_name: snapshot.ownerSProfile?.full_name ?? null, email: ownerSAuth.email };

    for (const key of RUN_USERS) await createRunUser(key);
    ctx.workspaceB = await createRunWorkspace("B");
    ctx.workspaceD = await createRunWorkspace("D");
    await addMember(ctx.S.id, "s_admin", "admin");
    await addMember(ctx.S.id, "s_manager", "manager");
    await addMember(ctx.S.id, "s_member", "member");
    await addMember(ctx.S.id, "s_removed", "admin", new Date().toISOString());
    await addMember(ctx.S.id, "both", "member");
    await addMember(ctx.workspaceB, "b_admin", "admin");
    await addMember(ctx.workspaceB, "both", "member");
    await addMember(ctx.workspaceD, "d_admin", "admin");
    check(await admin.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", ctx.workspaceD), "soft-delete workspace D");
    check(await admin.from("profiles").update({ active_workspace_id: ctx.S.id }).eq("id", ctx.users.stranger.id), "point stranger's active workspace at S");
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
      ownerSProfile: await profileOf(snapshot.ownerS[0].user_id),
      counts: await tableCounts(),
    };
    console.log(`cleanup: counts before=${JSON.stringify(snapshot.counts)} after=${JSON.stringify(final.counts)}`);
    if (cleanupError) throw cleanupError;
    assert.deepEqual(final.A, snapshot.A, "workspace A row must be untouched");
    assert.deepEqual(final.S, snapshot.S, "workspace S row must be untouched");
    assert.deepEqual(final.ownerA, snapshot.ownerA, "owner membership of A must be untouched");
    assert.deepEqual(final.ownerS, snapshot.ownerS, "owner membership of S must be untouched");
    assert.deepEqual(final.ownerSProfile, snapshot.ownerSProfile, "owner_S's profile must be untouched");
    assert.deepEqual(final.counts, snapshot.counts, "every counted table must be back to its pre-run size");
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);
  const S_MEMBERS = ["owner_S", "s_admin", "s_manager", "s_member", "both"];

  it("P0 profiles RLS shows a member only their own profile row, which is why the list needs a function", async () => {
    const ids = S_MEMBERS.filter((key) => key !== "owner_S").map((key) => ctx.users[key].id);
    const rows = expectOk(await ctx.users.s_member.client.from("profiles").select("id").in("id", ids));
    assert.deepEqual(rows, [{ id: ctx.users.s_member.id }]);
  });

  // L. workspace_member_profiles: any active member, active members only, nothing else
  for (const key of ["owner_S", "s_admin", "s_manager", "s_member"]) {
    it(`L1 ${key} lists exactly the active members of S (user_id, full_name, Auth email)`, async () => {
      assertMembers(expectOk(await listMembers(key, ctx.S.id)), S_MEMBERS, `${key} on S`);
    });
  }

  it("L2 workspace B lists only B's members, to B's admin and to a member of both workspaces", async () => {
    assertMembers(expectOk(await listMembers("b_admin", ctx.workspaceB)), ["b_admin", "both"], "b_admin on B");
    assertMembers(expectOk(await listMembers("both", ctx.workspaceB)), ["b_admin", "both"], "both on B");
    assertMembers(expectOk(await listMembers("both", ctx.S.id)), S_MEMBERS, "both on S");
  });

  it("L3 a removed member of S is rejected (42501)", async (t) => {
    expectRejected(t, await listMembers("s_removed", ctx.S.id), "42501", NO_ACCESS);
  });

  it("L4 a non-member whose profiles.active_workspace_id points at S is rejected (42501)", async (t) => {
    assert.equal((await profileOf(ctx.users.stranger.id)).active_workspace_id, ctx.S.id);
    expectRejected(t, await listMembers("stranger", ctx.S.id), "42501", NO_ACCESS);
  });

  it("L5 cross-workspace calls are rejected both ways (42501)", async (t) => {
    expectRejected(t, await listMembers("b_admin", ctx.S.id), "42501", NO_ACCESS);
    expectRejected(t, await listMembers("s_admin", ctx.workspaceB), "42501", NO_ACCESS);
  });

  it("L6 an admin of a soft-deleted workspace is rejected (42501)", async (t) => {
    expectRejected(t, await listMembers("d_admin", ctx.workspaceD), "42501", NO_ACCESS);
  });

  it("L7 an unknown workspace id is rejected (42501)", async (t) => {
    expectRejected(t, await listMembers("owner_S", randomUUID()), "42501", NO_ACCESS);
  });

  it("L8 anonymous callers have no EXECUTE (42501)", async (t) => {
    expectRejected(t, await listMembers("anon", ctx.S.id), "42501", /^permission denied for function workspace_member_profiles$/);
  });

  // F. workspace_member_find_user: owners and admins, exact email, id only
  for (const key of ["owner_S", "s_admin"]) {
    it(`F1 ${key} finds an account with no membership by its exact email`, async () => {
      assert.equal(expectOk(await findUser(key, ctx.S.id, ctx.users.newbie.email)), ctx.users.newbie.id);
    });
  }

  it("F2 the lookup ignores case and surrounding spaces", async () => {
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, `  ${ctx.users.newbie.email.toUpperCase()} `)), ctx.users.newbie.id);
  });

  it("F3 partial emails and patterns find nothing", async () => {
    const email = ctx.users.newbie.email;
    const [local, domain] = email.split("@");
    for (const value of [local, `@${domain}`, domain, email.slice(0, -1), `${email}x`, `${local.slice(0, -1)}_@${domain}`, `%@${domain}`, `${RUN_EMAIL_PREFIX}%`, "%", ""]) {
      assert.equal(expectOk(await findUser("owner_S", ctx.S.id, value)), null, JSON.stringify(value));
    }
  });

  it("F4 an email with no account returns null", async () => {
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, `${RUN_EMAIL_PREFIX}${RUN}-nobody@example.com`)), null);
  });

  it("F5 existing, removed and own accounts are returned so the app can refuse or restore them", async () => {
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, ctx.users.s_member.email)), ctx.users.s_member.id, "active member");
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, ctx.users.s_removed.email)), ctx.users.s_removed.id, "removed member");
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, FIXTURE_OWNER_S_EMAIL)), ctx.ownerSUser.user_id, "caller's own account");
  });

  it("F6 an account that belongs to another workspace is returned as a bare id", async () => {
    const found = expectOk(await findUser("s_admin", ctx.S.id, ctx.users.b_admin.email));
    assert.equal(typeof found, "string");
    assert.match(found, UUID);
    assert.equal(found, ctx.users.b_admin.id);
  });

  it("F7 manager and member of S cannot look up accounts (42501)", async (t) => {
    for (const key of ["s_manager", "s_member"]) expectRejected(t, await findUser(key, ctx.S.id, ctx.users.newbie.email), "42501", NO_PERMISSION);
  });

  it("F8 removed admin, non-member with active_workspace_id = S, other workspace's admin and admin of a soft-deleted workspace are rejected (42501)", async (t) => {
    for (const key of ["s_removed", "stranger", "b_admin"]) expectRejected(t, await findUser(key, ctx.S.id, ctx.users.newbie.email), "42501", NO_PERMISSION);
    expectRejected(t, await findUser("d_admin", ctx.workspaceD, ctx.users.newbie.email), "42501", NO_PERMISSION);
  });

  it("F9 anonymous callers have no EXECUTE (42501)", async (t) => {
    expectRejected(t, await findUser("anon", ctx.S.id, ctx.users.newbie.email), "42501", /^permission denied for function workspace_member_find_user$/);
  });

  it("M1 the database rejects a second membership for an existing member (23505), backing the app's 'already a team member' check", async (t) => {
    expectRejected(t, await ctx.users.s_admin.client.from("workspace_members").insert({ workspace_id: ctx.S.id, user_id: ctx.users.s_member.id, role: "member" }), "23505", DUPLICATE_MEMBER);
  });

  it("X1 a member who rewrites their own profiles.email cannot impersonate: the list keeps the Auth email and the lookup returns the real account", async () => {
    const spoofed = expectOk(await ctx.users.s_member.client.from("profiles").update({ email: ctx.users.newbie.email }).eq("id", ctx.users.s_member.id).select("id, email"));
    assert.deepEqual(spoofed, [{ id: ctx.users.s_member.id, email: ctx.users.newbie.email }], "setup: the member can rewrite their own profiles.email");
    const listed = expectOk(await listMembers("owner_S", ctx.S.id)).find((row) => row.user_id === ctx.users.s_member.id);
    assert.equal(listed?.email, ctx.users.s_member.email);
    assert.equal(expectOk(await findUser("owner_S", ctx.S.id, ctx.users.newbie.email)), ctx.users.newbie.id);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
}
