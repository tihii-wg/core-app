// Behavioral tests for supabase/migrations/20260929000400_workspace_logo_storage_policies.sql
// against the hosted TEST project. Run explicitly with `npm run test:supabase` (reads .env.test.local).
// LOGO_PLAN_ONLY=1 checks the target and lists the steps without any network write.
//
// Every Storage call under test runs as a real Auth user (or anonymously) through the publishable
// key, exactly like the app (private bucket "workspace", object {workspace_id}/logo.webp, upload
// with upsert, createSignedUrl, remove). The secret key is used only for setup and cleanup:
// creating/deleting run users, a per-run workspace, non-owner memberships (one already removed),
// issuing a sign-in link for owner_S, reading objects back and removing run objects.
//
// Persistent fixtures (never modified here):
// - owner_S (core-test+owner-s@example.com) and "core-test fixture workspace S": the workspace the
//   run logo lives in. The workspace row and its owner membership are never written; the suite
//   refuses to run if S already has a logo object.
// No owner membership is ever created (owner memberships cannot be deleted), and no DELETE is
// ever sent to workspace_members.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_S_EMAIL = "core-test+owner-s@example.com";
const FIXTURE_WORKSPACE_S = "core-test fixture workspace S";
const RUN_EMAIL_PREFIX = "core-test+logo-";
const RUN_WORKSPACE_PREFIX = "core-test logo run ";
const BUCKET = "workspace";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const planOnly = process.env.LOGO_PLAN_ONLY === "1";

const RLS_DENIED = /^new row violates row-level security policy/;
const NOT_FOUND = /^Object not found$/;

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

const ctx = { S: null, workspaceB: null, ownerS: null, users: {} };

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.statusCode ?? result.error.code ?? ""} ${result.error.message}`);
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

async function createRunUser(key) {
  const email = `${RUN_EMAIL_PREFIX}${RUN}-${key}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`);
  ctx.users[key] = { id: created.user.id, email, client: await signedInClient(email, password) };
}

async function addMember(workspaceId, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} as ${role}`);
}

function clientOf(key) {
  if (key === "anon") return anonClient();
  return key === "owner_S" ? ctx.ownerS : ctx.users[key].client;
}

const logoPath = (workspaceId) => `${workspaceId}/logo.webp`;
const payload = (label) => new Blob([`core-test logo ${RUN} ${label}`], { type: "image/webp" });

function upload(key, path, label) {
  return clientOf(key).storage.from(BUCKET).upload(path, payload(label), { upsert: true, contentType: "image/webp", cacheControl: "0" });
}

function sign(key, path) {
  return clientOf(key).storage.from(BUCKET).createSignedUrl(path, 3600);
}

function remove(key, path) {
  return clientOf(key).storage.from(BUCKET).remove([path]);
}

// Reads the stored object back with the secret key: null when absent, otherwise its text.
async function storedContent(path) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error) {
    if (NOT_FOUND.test(error.message)) return null;
    throw new Error(`read back ${path}: ${error.message}`);
  }
  return data.text();
}

function expectDenied(t, result, pattern) {
  assert.ok(result.error, "expected Storage to refuse, the operation succeeded");
  assert.match(result.error.message, pattern);
  t.diagnostic(`${result.error.name}: ${result.error.message}`);
}

function expectOk(result) {
  assert.equal(result.error, null, result.error ? `${result.error.name}: ${result.error.message}` : undefined);
  return result.data;
}

async function sweep(scope) {
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN}%` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;
  if (!ctx.S?.id) throw new Error("Refusing to sweep before fixture S is identified");

  const S = ctx.S.id;
  const stored = await storedContent(logoPath(S));
  if (stored !== null && stored.startsWith(scope === "run" ? `core-test logo ${RUN} ` : "core-test logo ")) {
    check(await admin.storage.from(BUCKET).remove([logoPath(S)]), "remove run logo of S");
  }
  const runWorkspaces = check(await admin.from("workspaces").select("id, owner_id").like("name", workspaceFilter).neq("id", S), "find run workspaces");
  for (const workspace of runWorkspaces) {
    if (workspace.owner_id) throw new Error(`Run workspace ${workspace.id} has an owner; resolve manually`);
    check(await admin.storage.from(BUCKET).remove([logoPath(workspace.id)]), "remove run workspace logo");
    check(await admin.from("workspaces").delete().eq("id", workspace.id), "delete run workspace");
  }
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && item.email !== FIXTURE_OWNER_S_EMAIL && item.id !== ctx.S.owner_id)) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`workspace_logo_storage on TEST project ${target.ref}`, { concurrency: false }, () => {
  let snapshot;

  before(async () => {
    if (planOnly) return;
    ctx.S = await findFixture(FIXTURE_WORKSPACE_S);
    await sweep("all");
    const existing = await storedContent(logoPath(ctx.S.id));
    if (existing !== null) throw new Error("Workspace S already has a logo object that this suite did not create; resolve manually");
    snapshot = { S: ctx.S, ownerS: await ownerMembership(ctx.S.id) };
    assert.equal(snapshot.ownerS.length, 1, "workspace S must have exactly one owner membership");
    assert.equal(snapshot.ownerS[0].deleted_at, null);

    for (const key of ["s_admin", "s_manager", "s_member", "s_removed", "b_admin", "stranger"]) await createRunUser(key);
    ctx.workspaceB = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} B`, owner_id: null }).select("id").single(), "create workspace B").id;
    await addMember(ctx.S.id, "s_admin", "admin");
    await addMember(ctx.S.id, "s_manager", "manager");
    await addMember(ctx.S.id, "s_member", "member");
    await addMember(ctx.S.id, "s_removed", "admin", new Date().toISOString());
    await addMember(ctx.workspaceB, "b_admin", "admin");
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
    const finalS = check(await admin.from("workspaces").select("*").eq("id", ctx.S.id).single(), "workspace S after");
    assert.deepEqual(finalS, snapshot.S, "workspace S row changed");
    assert.deepEqual(await ownerMembership(ctx.S.id), snapshot.ownerS, "owner_S membership changed");
    assert.equal(await storedContent(logoPath(ctx.S.id)), null, "run logo of S was left behind");
    if (cleanupError) throw cleanupError;
  });

  test("P0 target is the TEST project, never production", () => {
    assert.notEqual(target.ref, PRODUCTION_REF);
    if (planOnly) {
      console.log(`[plan] TEST project ${target.ref}; run ${RUN}`);
      console.log("[plan] setup: run users s_admin, s_manager, s_member, s_removed (removed admin), b_admin, stranger; run workspace B (no owner); owner_S via sign-in link");
      console.log("[plan] tests L1-L12 below; cleanup removes run objects, workspace B and run users");
    }
  });

  if (planOnly) return;

  const S = () => ctx.S.id;

  test("L1 owner uploads a new logo and loads it through a signed URL", async () => {
    expectOk(await upload("owner_S", logoPath(S()), "owner-1"));
    const signed = expectOk(await sign("owner_S", logoPath(S())));
    const response = await fetch(signed.signedUrl);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `core-test logo ${RUN} owner-1`);
  });

  test("L2 owner replaces the existing logo (upsert)", async () => {
    expectOk(await upload("owner_S", logoPath(S()), "owner-2"));
    assert.equal(await storedContent(logoPath(S())), `core-test logo ${RUN} owner-2`);
  });

  test("L3 admin replaces the logo and loads it", async () => {
    expectOk(await upload("s_admin", logoPath(S()), "admin-1"));
    expectOk(await sign("s_admin", logoPath(S())));
    assert.equal(await storedContent(logoPath(S())), `core-test logo ${RUN} admin-1`);
  });

  test("L4 manager and member can load the logo", async () => {
    expectOk(await sign("s_manager", logoPath(S())));
    expectOk(await sign("s_member", logoPath(S())));
  });

  for (const key of ["s_manager", "s_member"]) {
    test(`L5 ${key} cannot upload, replace or delete the logo`, async (t) => {
      expectDenied(t, await upload(key, logoPath(S()), `${key}-attempt`), RLS_DENIED);
      const removed = expectOk(await remove(key, logoPath(S())));
      assert.equal(removed.length, 0, "remove must not delete anything");
      assert.equal(await storedContent(logoPath(S())), `core-test logo ${RUN} admin-1`);
    });
  }

  for (const key of ["s_removed", "stranger", "b_admin", "anon"]) {
    test(`L6 ${key} cannot load, upload or delete the logo of S`, async (t) => {
      expectDenied(t, await sign(key, logoPath(S())), NOT_FOUND);
      expectDenied(t, await upload(key, logoPath(S()), `${key}-attempt`), RLS_DENIED);
      const removed = await remove(key, logoPath(S()));
      assert.equal(removed.data?.length ?? 0, 0, "remove must not delete anything");
      assert.equal(await storedContent(logoPath(S())), `core-test logo ${RUN} admin-1`);
    });
  }

  for (const suffix of ["other.png", "sub/logo.webp", "logo.webp/extra"]) {
    test(`L7 an admin cannot store a non-logo path ({workspace_id}/${suffix})`, async (t) => {
      expectDenied(t, await upload("s_admin", `${S()}/${suffix}`, "other"), RLS_DENIED);
      assert.equal(await storedContent(`${S()}/${suffix}`), null);
    });
  }

  test("L8 a folder that is not a workspace id is refused as a permission error", async (t) => {
    expectDenied(t, await upload("s_admin", "not-a-workspace/logo.webp", "bad-folder"), RLS_DENIED);
    expectDenied(t, await upload("s_admin", "logo.webp", "root"), RLS_DENIED);
    expectDenied(t, await sign("s_admin", "not-a-workspace/logo.webp"), NOT_FOUND);
    assert.equal(await storedContent("not-a-workspace/logo.webp"), null);
  });

  test("L9 an admin of another workspace manages only that workspace's logo", async () => {
    expectOk(await upload("b_admin", logoPath(ctx.workspaceB), "b-1"));
    expectOk(await sign("b_admin", logoPath(ctx.workspaceB)));
    const removed = expectOk(await remove("b_admin", logoPath(ctx.workspaceB)));
    assert.equal(removed.length, 1);
  });

  test("L10 an admin of S cannot read workspace B's logo", async (t) => {
    expectOk(await upload("b_admin", logoPath(ctx.workspaceB), "b-2"));
    expectDenied(t, await sign("s_admin", logoPath(ctx.workspaceB)), NOT_FOUND);
    expectDenied(t, await upload("s_admin", logoPath(ctx.workspaceB), "cross"), RLS_DENIED);
    assert.equal(await storedContent(logoPath(ctx.workspaceB)), `core-test logo ${RUN} b-2`);
  });

  test("L11 admin deletes the logo of S", async () => {
    const removed = expectOk(await remove("s_admin", logoPath(S())));
    assert.equal(removed.length, 1);
    assert.equal(await storedContent(logoPath(S())), null);
  });

  test("L12 admin uploads a new logo, owner deletes it", async () => {
    expectOk(await upload("s_admin", logoPath(S()), "admin-2"));
    assert.equal(await storedContent(logoPath(S())), `core-test logo ${RUN} admin-2`);
    const removed = expectOk(await remove("owner_S", logoPath(S())));
    assert.equal(removed.length, 1);
    assert.equal(await storedContent(logoPath(S())), null);
  });
});
