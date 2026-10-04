// Behavioral tests for supabase/migrations/20261004010000_invoices.sql,
// 20261004020000_invoice_number_counters.sql and 20261004030000_protect_invoice_created_at.sql
// against the hosted TEST project. Run explicitly (reads
// .env.test.local); INVOICES_PLAN_ONLY=1 checks the target without any network request. Skips with
// a message while the invoices tables or the invoice number counters are missing.
//
// Every read and write under test runs as a real Auth user (or anonymously) through the publishable
// key, sending the requests src/services/apiInvoices.ts sends. The secret key is used only for setup
// and cleanup: run users, per-run workspaces W, B and C (no owner), non-owner memberships (one already
// removed), run services, clients, orders, order lines, one invoice sent with a chosen created_at
// (V19, to show the database replaces it for every role), reading the counters, and
// snapshotting/deleting run data.
//
// Invoice number counters never go back and only disappear with their workspace, so every invoice
// lives in a run workspace; deleting the run workspaces removes their invoices and counters.
// Persistent fixture (never modified here): owner_A and "core-test fixture workspace A", only read to
// prove they are untouched. Run rows are tagged with the run id and removed in `after`, including
// leftovers of earlier interrupted runs. No DELETE is ever sent to workspace_members.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "pundggjzzaqzbvykbxvo";
const FIXTURE_OWNER_A_EMAIL = "core-test+owner-a@example.com";
const FIXTURE_WORKSPACE_A = "core-test fixture workspace A";
const RUN_EMAIL_PREFIX = "core-test+inv-";
const RUN_WORKSPACE_PREFIX = "core-test inv run ";
const RUN_ROW_PREFIX = "core-test-inv-";
const RUN_ORDER_PREFIX = "CORE-TEST-INV-";
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `${RUN_ROW_PREFIX}${RUN}`;
const planOnly = process.env.INVOICES_PLAN_ONLY === "1";

const TABLE_DENIED = (table) => new RegExp(`^permission denied for table ${table}$`);
const RLS_DENIED = (table) => new RegExp(`^new row violates row-level security policy for table "${table}"$`);
const INVOICE_COLUMNS = "id, workspace_id, order_id, client_id, number, status, client_name, order_number, device, car_number, vin, description, subtotal, total, due_date, paid_at, created_at";
const ITEM_COLUMNS = "id, invoice_id, service_id, service_name, price, quantity, position";
// Allowed difference between this machine's clock and the database's when checking created_at.
const CLOCK_SKEW_MS = 120_000;
const COUNTED_TABLES = ["workspaces", "workspace_members", "services", "clients", "orders", "order_services", "invoices", "invoice_items", "invoice_number_counters", "profiles"];

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

let missingSchema = null;
if (!planOnly) {
  for (const [table, migration] of [["invoices", "20261004010000_invoices.sql"], ["invoice_number_counters", "20261004020000_invoice_number_counters.sql"]]) {
    const { error } = await admin.from(table).select("*").limit(1);
    if (error?.code === "PGRST205" || error?.code === "42P01") {
      missingSchema = `${error.message}: apply supabase/migrations/${migration} to TEST first`;
      break;
    }
    if (error) throw new Error(`probe ${table}: ${error.code} ${error.message}`);
  }
}

const ctx = { A: null, ws: {}, users: {}, services: {}, orders: {}, invoices: {}, year: null, snapshots: {} };

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

/** Same rule as the counters migration: the year of created_at in the workspace time zone. */
function yearInTimeZone(timestamp, timeZone) {
  const year = (zone) => Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(new Date(timestamp)));
  try {
    return year(timeZone?.trim() || "Europe/Chisinau");
  } catch {
    return year("Europe/Chisinau");
  }
}

const num = (year, sequence) => `INV-${year}-${String(sequence).padStart(3, "0")}`;
const pendingNumber = () => `INV-PENDING-${randomUUID()}`;

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

async function createRunWorkspace(key) {
  ctx.ws[key] = check(await admin.from("workspaces").insert({ name: `${RUN_WORKSPACE_PREFIX}${RUN} ${key}`, owner_id: null }).select("id, timezone").single(), `create workspace ${key}`);
}

async function addMember(workspaceKey, userKey, role, deletedAt = null) {
  check(await admin.from("workspace_members").insert({ workspace_id: ctx.ws[workspaceKey].id, user_id: ctx.users[userKey].id, role, deleted_at: deletedAt }), `add ${userKey} to ${workspaceKey} as ${role}`);
}

async function seedService(key, workspaceKey, price) {
  ctx.services[key] = check(await admin.from("services").insert({ workspace_id: ctx.ws[workspaceKey].id, service_name: `${TAG} ${key}`, service_price: price, status: "active" }).select("id, service_name, service_price").single(), `seed service ${key}`);
}

async function seedOrder(key, workspaceKey, lines) {
  const workspaceId = ctx.ws[workspaceKey].id;
  const client = check(await admin.from("clients").insert({ workspace_id: workspaceId, name: `${TAG} client ${key}` }).select("id, name").single(), `seed client ${key}`);
  const order = check(
    await admin
      .from("orders")
      .insert({ workspace_id: workspaceId, client_id: client.id, number: `${RUN_ORDER_PREFIX}${RUN}-${key}`, device: "Golf IV", car_number: "ABC123", vin: "WVWZZZ1JZXW000001", description: `${TAG} brakes squeak`, assigned_to: null, created_by: null })
      .select("*")
      .single(),
    `seed order ${key}`,
  );
  for (const [serviceKey, quantity] of lines) {
    const service = ctx.services[serviceKey];
    check(await admin.from("order_services").insert({ order_id: order.id, service_id: service.id, service_name: service.service_name, price: service.service_price, quantity }), `seed line ${key}/${serviceKey}`);
  }
  ctx.orders[key] = { ...order, client, workspaceKey };
}

// The app's request that has the database issue the number of an unfinished invoice.
async function issueAs(userKey, invoice) {
  return ctx.users[userKey].client.from("invoices").update({ number: "INV-NEXT" }).eq("id", invoice.id).eq("workspace_id", invoice.workspace_id).eq("number", invoice.number).select(INVOICE_COLUMNS).maybeSingle();
}

async function insertPendingAs(userKey, workspaceKey, label) {
  return expectOk(await ctx.users[userKey].client.from("invoices").insert({ workspace_id: ctx.ws[workspaceKey].id, number: pendingNumber(), client_name: `${TAG} ${label}` }).select(INVOICE_COLUMNS).single());
}

// The requests createInvoiceFromOrder sends, as the given user: unfinished invoice, its lines, then the number.
async function createInvoiceAs(userKey, orderKey) {
  const db = ctx.users[userKey].client;
  const order = ctx.orders[orderKey];
  const workspaceId = ctx.ws[order.workspaceKey].id;
  const lines = expectOk(await db.from("order_services").select("service_id, service_name, price, quantity").eq("order_id", order.id).order("created_at", { ascending: true }));
  const items = lines.map((line, index) => ({ service_id: line.service_id, service_name: line.service_name, price: Number(line.price), quantity: Number(line.quantity), position: index }));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;

  const inserted = expectOk(
    await db
      .from("invoices")
      .insert({ workspace_id: workspaceId, order_id: order.id, client_id: order.client_id, number: pendingNumber(), status: "draft", client_name: order.client.name, order_number: order.number, device: order.device, car_number: order.car_number, vin: order.vin, description: order.description, subtotal, total: subtotal })
      .select(INVOICE_COLUMNS)
      .single(),
  );
  const savedItems = expectOk(await db.from("invoice_items").insert(items.map((item) => ({ invoice_id: inserted.id, ...item }))).select(ITEM_COLUMNS));
  const invoice = expectOk(await issueAs(userKey, inserted));
  assert.ok(invoice, "the number was not issued (0 rows)");
  return { inserted, invoice, items: savedItems };
}

function assertDatabaseTime(createdAt, start, end, label) {
  const at = Date.parse(createdAt);
  assert.ok(
    at >= start - CLOCK_SKEW_MS && at <= end + CLOCK_SKEW_MS,
    `${label}: created_at ${createdAt} is not the database time of the request (${new Date(start).toISOString()} .. ${new Date(end).toISOString()}, ±${CLOCK_SKEW_MS / 1000}s); is supabase/migrations/20261004030000_protect_invoice_created_at.sql applied to TEST?`,
  );
}

// Inserts an unfinished invoice in W sending created_at = `sent`; the database must store its own time.
async function insertDatedAs(db, sent, label) {
  const start = Date.now();
  const inserted = expectOk(await db.from("invoices").insert({ workspace_id: ctx.ws.W.id, number: pendingNumber(), client_name: `${TAG} ${label}`, created_at: sent }).select(INVOICE_COLUMNS).single());
  const end = Date.now();
  assert.notEqual(Date.parse(inserted.created_at), Date.parse(sent), `${label}: the database stored the created_at the client sent`);
  assertDatabaseTime(inserted.created_at, start, end, label);
  const stored = await invoiceById(inserted.id);
  assert.equal(stored.created_at, inserted.created_at, `${label}: the stored row differs from what the insert returned`);
  return inserted;
}

async function invoiceById(id) {
  return check(await admin.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle(), "read invoice");
}

async function counterOf(workspaceKey, year) {
  return check(await admin.from("invoice_number_counters").select("last_number").eq("workspace_id", ctx.ws[workspaceKey].id).eq("year", year).maybeSingle(), "read counter")?.last_number ?? null;
}

async function sweep(scope) {
  const rowFilter = scope === "run" ? `${TAG}%` : `${RUN_ROW_PREFIX}%`;
  const orderFilter = scope === "run" ? `${RUN_ORDER_PREFIX}${RUN}%` : `${RUN_ORDER_PREFIX}%`;
  const workspaceFilter = scope === "run" ? `${RUN_WORKSPACE_PREFIX}${RUN}%` : `${RUN_WORKSPACE_PREFIX}%`;
  const emailPrefix = scope === "run" ? `${RUN_EMAIL_PREFIX}${RUN}-` : RUN_EMAIL_PREFIX;

  if (!ctx.A?.id) throw new Error("Refusing to sweep before fixture A is identified");

  // Invoices cascade to their items; deleting the run workspaces also removes their counters.
  check(await admin.from("invoices").delete().like("client_name", rowFilter), "delete run invoices");
  check(await admin.from("orders").delete().like("number", orderFilter), "delete run orders");
  check(await admin.from("clients").delete().like("name", rowFilter), "delete run clients");
  check(await admin.from("services").delete().like("service_name", rowFilter), "delete run services");
  check(await admin.from("workspaces").delete().like("name", workspaceFilter).neq("id", ctx.A.id), "delete run workspaces");
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "list users");
    for (const user of users.filter((item) => item.email?.startsWith(emailPrefix) && item.email !== FIXTURE_OWNER_A_EMAIL && item.id !== ctx.A.owner_id)) {
      check(await admin.auth.admin.deleteUser(user.id), `delete user ${user.email}`);
    }
    if (users.length < 1000) break;
  }
}

describe(`invoices on TEST project ${target.ref}`, { concurrency: false, skip: missingSchema ?? false }, () => {
  let snapshot;

  before(async () => {
    if (planOnly) return;
    ctx.A = await findFixture(FIXTURE_WORKSPACE_A);
    await sweep("all");
    snapshot = { A: ctx.A, ownerA: await ownerMembership(ctx.A.id), counts: await tableCounts() };

    for (const key of ["w_member", "w_removed", "b_admin", "c_member", "stranger"]) await createRunUser(key);
    for (const key of ["W", "B", "C"]) await createRunWorkspace(key);
    await addMember("W", "w_member", "member");
    await addMember("W", "w_removed", "member", new Date().toISOString());
    await addMember("B", "b_admin", "admin");
    await addMember("C", "c_member", "member");

    await seedService("oil", "W", 40);
    await seedService("brake", "W", 25);
    await seedService("b_wash", "B", 15);
    await seedService("c_fix", "C", 30);
    await seedOrder("W1", "W", [["oil", 1], ["brake", 2]]);
    await seedOrder("W2", "W", [["oil", 1]]);
    await seedOrder("B1", "B", [["b_wash", 1]]);
    for (const key of ["C1", "C2", "C3", "C4"]) await seedOrder(key, "C", [["c_fix", 1]]);
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
      ownerA: await ownerMembership(ctx.A.id),
      counts: await tableCounts(),
    };
    console.log(`cleanup: counts before=${JSON.stringify(snapshot.counts)} after=${JSON.stringify(final.counts)}`);
    if (cleanupError) throw cleanupError;
    assert.deepEqual(final.A, snapshot.A, "workspace A row must be untouched");
    assert.deepEqual(final.ownerA, snapshot.ownerA, "owner membership of A must be untouched");
    assert.deepEqual(final.counts, snapshot.counts, "every counted table must be back to its pre-run size");
  });

  const it = (name, fn) => test(name, { skip: planOnly ? "plan only" : false }, fn);

  it("V1 a member creates an invoice from an order the way the app does: created_at set by the database, INV-YYYY-001 from it, order data and lines copied", async (t) => {
    const start = Date.now();
    const { inserted, invoice, items } = await createInvoiceAs("w_member", "W1");
    assertDatabaseTime(inserted.created_at, start, Date.now(), "V1 insert without created_at");
    const order = ctx.orders.W1;
    ctx.year = yearInTimeZone(inserted.created_at, ctx.ws.W.timezone);
    ctx.invoices.W1 = invoice;

    assert.match(inserted.number, /^INV-PENDING-/);
    assert.equal(invoice.number, num(ctx.year, 1));
    assert.equal(invoice.created_at, inserted.created_at);
    t.diagnostic(`number ${invoice.number}, created_at ${invoice.created_at}, workspace timezone ${ctx.ws.W.timezone}`);
    assert.deepEqual(
      { workspace_id: invoice.workspace_id, order_id: invoice.order_id, client_id: invoice.client_id, status: invoice.status, client_name: invoice.client_name, order_number: invoice.order_number, device: invoice.device, car_number: invoice.car_number, vin: invoice.vin, description: invoice.description, subtotal: Number(invoice.subtotal), total: Number(invoice.total) },
      { workspace_id: ctx.ws.W.id, order_id: order.id, client_id: order.client_id, status: "draft", client_name: order.client.name, order_number: order.number, device: "Golf IV", car_number: "ABC123", vin: "WVWZZZ1JZXW000001", description: order.description, subtotal: 90, total: 90 },
    );
    assert.deepEqual(
      items.sort((a, b) => a.position - b.position).map((item) => [item.service_name, Number(item.price), item.quantity, item.position]),
      [[ctx.services.oil.service_name, 40, 1, 0], [ctx.services.brake.service_name, 25, 2, 1]],
    );
  });

  it("V2 a second invoice for the same order is rejected by invoices_order_id_key (23505)", async (t) => {
    const order = ctx.orders.W1;
    expectRejected(t, await ctx.users.w_member.client.from("invoices").insert({ workspace_id: ctx.ws.W.id, order_id: order.id, client_id: order.client_id, number: pendingNumber(), client_name: order.client.name }), "23505", /invoices_order_id_key/);
    assert.equal(check(await admin.from("invoices").select("id").eq("order_id", order.id), "count").length, 1);
  });

  it("V3 the issued number, workspace_id, order_id and created_at cannot change (42501); status can", async (t) => {
    const db = ctx.users.w_member.client;
    const id = ctx.invoices.W1.id;
    expectRejected(t, await db.from("invoices").update({ number: "INV-2099-999" }).eq("id", id), "42501", /^An invoice number cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ number: pendingNumber() }).eq("id", id), "42501", /^An invoice number cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ number: "INV-NEXT" }).eq("id", id), "42501", /^An invoice number cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ workspace_id: ctx.ws.B.id }).eq("id", id), "42501", /^workspace_id cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ order_id: ctx.orders.W2.id }).eq("id", id), "42501", /^order_id cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ order_id: null }).eq("id", id), "42501", /^order_id cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ created_at: "2000-01-01T00:00:00Z" }).eq("id", id), "42501", /^created_at cannot be changed$/);
    expectRejected(t, await db.from("invoices").update({ created_at: "2099-12-31T23:59:59Z" }).eq("id", id), "42501", /^created_at cannot be changed$/);
    assert.deepEqual(expectOk(await db.from("invoices").update({ status: "sent" }).eq("id", id).select("number, status")), [{ number: ctx.invoices.W1.number, status: "sent" }]);
    assert.equal((await invoiceById(id)).number, ctx.invoices.W1.number);
  });

  it("V4 numbers come only from the database and each workspace has its own counter", async (t) => {
    const finalNumber = num(ctx.year, 1);
    expectRejected(t, await ctx.users.w_member.client.from("invoices").insert({ workspace_id: ctx.ws.W.id, number: num(ctx.year, 50), client_name: `${TAG} chosen` }), "42501", /^Invoice numbers are assigned by the database$/);
    expectRejected(t, await ctx.users.b_admin.client.from("invoices").insert({ workspace_id: ctx.ws.B.id, number: finalNumber, client_name: `${TAG} chosen` }), "42501", /^Invoice numbers are assigned by the database$/);
    const pending = await insertPendingAs("w_member", "W", "chosen later");
    expectRejected(t, await ctx.users.w_member.client.from("invoices").update({ number: num(ctx.year, 50) }).eq("id", pending.id), "42501", /^An invoice number cannot be changed$/);
    check(await ctx.users.w_member.client.from("invoices").delete().eq("id", pending.id).eq("number", pending.number), "remove the unfinished invoice");

    const { invoice } = await createInvoiceAs("b_admin", "B1");
    ctx.invoices.B1 = invoice;
    assert.equal(invoice.number, finalNumber, "B starts its own sequence");
    assert.equal(await counterOf("B", ctx.year), 1);
    assert.equal(await counterOf("W", ctx.year), 1);
    t.diagnostic(`W and B both hold ${finalNumber}`);
  });

  it("V5 B's admin, a removed member and a non-member read none of W's invoices or items; anonymous is denied; nobody but the database reaches the counters", async (t) => {
    for (const key of ["b_admin", "w_removed", "stranger"]) {
      assert.deepEqual(expectOk(await ctx.users[key].client.from("invoices").select("id").eq("id", ctx.invoices.W1.id)), [], key);
      assert.deepEqual(expectOk(await ctx.users[key].client.from("invoice_items").select("id").eq("invoice_id", ctx.invoices.W1.id)), [], key);
    }
    expectRejected(t, await anonClient().from("invoices").select("id"), "42501", TABLE_DENIED("invoices"));
    expectRejected(t, await anonClient().from("invoice_items").select("id"), "42501", TABLE_DENIED("invoice_items"));
    expectRejected(t, await ctx.users.w_member.client.from("invoice_number_counters").select("*"), "42501", TABLE_DENIED("invoice_number_counters"));
    expectRejected(t, await ctx.users.w_member.client.from("invoice_number_counters").update({ last_number: 0 }).eq("workspace_id", ctx.ws.W.id), "42501", TABLE_DENIED("invoice_number_counters"));
    expectRejected(t, await anonClient().from("invoice_number_counters").select("*"), "42501", TABLE_DENIED("invoice_number_counters"));
  });

  it("V6 outsiders cannot write or issue W's invoices, and an invoice cannot point at another workspace's order or client", async (t) => {
    const w2 = ctx.orders.W2;
    for (const key of ["b_admin", "w_removed"]) {
      expectRejected(t, await ctx.users[key].client.from("invoices").insert({ workspace_id: ctx.ws.W.id, order_id: w2.id, client_id: w2.client_id, number: pendingNumber(), client_name: `${TAG} x` }), "42501", RLS_DENIED("invoices"));
      expectRejected(t, await ctx.users[key].client.from("invoice_items").insert({ invoice_id: ctx.invoices.W1.id, service_name: `${TAG} x`, price: 1 }), "42501", RLS_DENIED("invoice_items"));
      assert.deepEqual(expectOk(await ctx.users[key].client.from("invoices").update({ status: "paid" }).eq("id", ctx.invoices.W1.id).select("id")), [], key);
      assert.deepEqual(expectOk(await ctx.users[key].client.from("invoices").delete().eq("id", ctx.invoices.W1.id).select("id")), [], key);
    }
    const pending = await insertPendingAs("w_member", "W", "outsider issue");
    for (const key of ["b_admin", "w_removed", "stranger"]) assert.equal(expectOk(await issueAs(key, pending)), null, `${key} issued W's invoice`);
    check(await ctx.users.w_member.client.from("invoices").delete().eq("id", pending.id).eq("number", pending.number), "remove the unfinished invoice");
    const b1 = ctx.orders.B1;
    expectRejected(t, await ctx.users.w_member.client.from("invoices").insert({ workspace_id: ctx.ws.W.id, order_id: b1.id, client_id: null, number: pendingNumber(), client_name: `${TAG} x` }), "42501", RLS_DENIED("invoices"));
    expectRejected(t, await ctx.users.w_member.client.from("invoices").insert({ workspace_id: ctx.ws.W.id, order_id: null, client_id: b1.client_id, number: pendingNumber(), client_name: `${TAG} x` }), "42501", RLS_DENIED("invoices"));
    assert.equal((await invoiceById(ctx.invoices.W1.id)).status, "sent");
    assert.equal(await counterOf("W", ctx.year), 1, "outsider attempts used no number");
  });

  it("V7 invoice items cannot be updated or deleted by authenticated users (42501)", async (t) => {
    const db = ctx.users.w_member.client;
    expectRejected(t, await db.from("invoice_items").update({ price: 1 }).eq("invoice_id", ctx.invoices.W1.id), "42501", TABLE_DENIED("invoice_items"));
    expectRejected(t, await db.from("invoice_items").delete().eq("invoice_id", ctx.invoices.W1.id), "42501", TABLE_DENIED("invoice_items"));
    assert.equal(check(await admin.from("invoice_items").select("id").eq("invoice_id", ctx.invoices.W1.id), "items").length, 2);
  });

  it("V8 the app's rollback: a member deletes an unfinished invoice with its lines; the lines go with it and no number is used", async () => {
    const db = ctx.users.w_member.client;
    const w2 = ctx.orders.W2;
    const pending = expectOk(await db.from("invoices").insert({ workspace_id: ctx.ws.W.id, order_id: w2.id, client_id: w2.client_id, number: pendingNumber(), client_name: w2.client.name }).select("id, number").single());
    expectOk(await db.from("invoice_items").insert({ invoice_id: pending.id, service_name: `${TAG} line`, price: 40 }));
    assert.deepEqual(expectOk(await db.from("invoices").delete().eq("id", pending.id).eq("workspace_id", ctx.ws.W.id).eq("number", pending.number).select("id")), [{ id: pending.id }]);
    assert.deepEqual(check(await admin.from("invoice_items").select("id").eq("invoice_id", pending.id), "items"), []);
    assert.equal(await counterOf("W", ctx.year), 1);
  });

  it("V9 editing the order and its service lines later leaves the invoice and its items as they were", async () => {
    const db = ctx.users.w_member.client;
    const before = await invoiceById(ctx.invoices.W1.id);
    const itemsBefore = check(await admin.from("invoice_items").select(ITEM_COLUMNS).eq("invoice_id", ctx.invoices.W1.id).order("position"), "items before");
    check(await db.from("orders").update({ device: "Passat", description: "changed", total_price: 1 }).eq("id", ctx.orders.W1.id).select("id"), "edit order");
    // updateOrder in src/services/apiOrders.ts changes lines by inserting new ones and deleting removed ones.
    const oldLines = check(await db.from("order_services").select("id").eq("order_id", ctx.orders.W1.id), "read order lines");
    check(await db.from("order_services").insert({ order_id: ctx.orders.W1.id, service_id: ctx.services.oil.id, service_name: ctx.services.oil.service_name, price: 1, quantity: 9 }).select("id"), "add order line");
    const removed = check(await db.from("order_services").delete().eq("order_id", ctx.orders.W1.id).in("id", oldLines.map((line) => line.id)).select("id"), "remove order lines");
    assert.equal(removed.length, oldLines.length, "the member could not remove the order lines");
    assert.deepEqual(await invoiceById(ctx.invoices.W1.id), before);
    assert.deepEqual(check(await admin.from("invoice_items").select(ITEM_COLUMNS).eq("invoice_id", ctx.invoices.W1.id).order("position"), "items after"), itemsBefore);
  });

  it("V10 the next invoice of the workspace gets the next consecutive number", async (t) => {
    const { invoice } = await createInvoiceAs("w_member", "W2");
    ctx.invoices.W2 = invoice;
    assert.equal(invoice.number, num(ctx.year, 2));
    t.diagnostic(`${ctx.invoices.W1.number} then ${invoice.number}`);
    ctx.snapshots.issued = [await invoiceById(ctx.invoices.W1.id), await invoiceById(ctx.invoices.W2.id), await invoiceById(ctx.invoices.B1.id)];
  });

  it("V11 a backdated created_at (2020-01-01) sent by a member is replaced by the database time; the number uses the current year", async (t) => {
    const sent = "2020-01-01T00:00:00Z";
    const inserted = await insertDatedAs(ctx.users.w_member.client, sent, "backdated");
    const invoice = expectOk(await issueAs("w_member", inserted));
    assert.equal(invoice.created_at, inserted.created_at);
    assert.equal(invoice.number, num(ctx.year, 3));
    assert.equal(await counterOf("W", 2020), null, "no 2020 counter was started");
    assert.equal(await counterOf("W", ctx.year), 3);
    t.diagnostic(`sent created_at ${sent}; stored ${inserted.created_at}; issued ${invoice.number}`);
  });

  it("V12 the number of a deleted invoice is not issued again: 001, 002, delete 002, next is 003", async (t) => {
    const first = (await createInvoiceAs("c_member", "C1")).invoice;
    const second = (await createInvoiceAs("c_member", "C2")).invoice;
    assert.deepEqual([first.number, second.number], [num(ctx.year, 1), num(ctx.year, 2)]);
    assert.deepEqual(expectOk(await ctx.users.c_member.client.from("invoices").delete().eq("id", second.id).select("number")), [{ number: second.number }]);
    const third = (await createInvoiceAs("c_member", "C3")).invoice;
    Object.assign(ctx.invoices, { C1: first, C3: third });
    t.diagnostic(`created ${first.number} and ${second.number}, deleted ${second.number}, next invoice got ${third.number}`);
    assert.equal(third.number, num(ctx.year, 3));
  });

  it("V13 deleting an older invoice does not affect numbering", async (t) => {
    assert.deepEqual(expectOk(await ctx.users.c_member.client.from("invoices").delete().eq("id", ctx.invoices.C1.id).select("number")), [{ number: num(ctx.year, 1) }]);
    const { invoice } = await createInvoiceAs("c_member", "C4");
    assert.equal(invoice.number, num(ctx.year, 4));
    t.diagnostic(`deleted ${num(ctx.year, 1)}, next invoice got ${invoice.number}`);
  });

  it("V14 concurrent issues get different, consecutive numbers", async (t) => {
    const pending = [];
    for (let index = 0; index < 6; index += 1) pending.push(await insertPendingAs("c_member", "C", `concurrent ${index}`));
    const results = await Promise.all(pending.map((invoice) => issueAs("c_member", invoice)));
    const numbers = results.map((result) => expectOk(result).number).sort();
    assert.deepEqual(numbers, [5, 6, 7, 8, 9, 10].map((sequence) => num(ctx.year, sequence)));
    assert.equal(await counterOf("C", ctx.year), 10);
    t.diagnostic(`6 parallel issues -> ${numbers.join(", ")}`);
  });

  it("V15 a creation that fails or is rolled back uses no number", async (t) => {
    const db = ctx.users.c_member.client;
    const failing = await insertPendingAs("c_member", "C", "failing issue");
    expectRejected(t, await db.from("invoices").update({ number: "INV-NEXT", status: "void" }).eq("id", failing.id), "23514", /invoices_status_check/);
    assert.equal((await invoiceById(failing.id)).number, failing.number, "the invoice is still unfinished");
    assert.equal(await counterOf("C", ctx.year), 10, "the failed statement rolled the counter back");
    check(await db.from("invoices").delete().eq("id", failing.id).eq("number", failing.number), "rollback delete");
    const next = expectOk(await issueAs("c_member", await insertPendingAs("c_member", "C", "after failure")));
    assert.equal(next.number, num(ctx.year, 11));
    t.diagnostic(`after the failed attempt the next number is ${next.number}`);
  });

  it("V16 issued invoices stay exactly as they were through later creations, deletions and failures", async () => {
    for (const saved of ctx.snapshots.issued) assert.deepEqual(await invoiceById(saved.id), saved);
    assert.equal((await invoiceById(ctx.invoices.C3.id)).number, num(ctx.year, 3));
  });

  it("V17 check constraints reject an unknown status, a malformed number and a non-positive item quantity (23514)", async (t) => {
    const db = ctx.users.w_member.client;
    const id = ctx.invoices.W2.id;
    expectRejected(t, await db.from("invoices").update({ status: "void" }).eq("id", id), "23514", /invoices_status_check/);
    expectRejected(t, await db.from("invoices").insert({ workspace_id: ctx.ws.W.id, number: "INV-PENDING-", client_name: `${TAG} bad number` }), "23514", /invoices_number_check/);
    expectRejected(t, await db.from("invoice_items").insert({ invoice_id: id, service_name: `${TAG} zero`, price: 1, quantity: 0 }), "23514", /invoice_items_quantity_check/);
  });

  it("V18 a future created_at (2099-12-31) sent by a member is replaced by the database time; the number uses the current year", async (t) => {
    const sent = "2099-12-31T23:59:59Z";
    const inserted = await insertDatedAs(ctx.users.w_member.client, sent, "future-dated");
    const invoice = expectOk(await issueAs("w_member", inserted));
    assert.equal(invoice.created_at, inserted.created_at);
    assert.equal(invoice.number, num(ctx.year, 4));
    assert.equal(await counterOf("W", 2099), null, "no 2099 counter was started");
    assert.equal(await counterOf("W", ctx.year), 4);
    t.diagnostic(`sent created_at ${sent}; stored ${inserted.created_at}; issued ${invoice.number}`);
  });

  it("V19 the database replaces a chosen created_at for every role, including the secret key", async (t) => {
    const sent = "2020-01-01T00:00:00Z";
    const inserted = await insertDatedAs(admin, sent, "secret key backdated");
    const invoice = expectOk(await issueAs("w_member", inserted));
    assert.equal(invoice.number, num(ctx.year, 5));
    assert.equal(await counterOf("W", 2020), null);
    t.diagnostic(`secret key sent created_at ${sent}; stored ${inserted.created_at}; issued ${invoice.number}`);
  });
});

if (planOnly) {
  console.log(`plan only: target ${target.ref} verified (production ${PRODUCTION_REF}); no requests were made`);
} else if (missingSchema) {
  console.log(`skipped: ${missingSchema}`);
}
