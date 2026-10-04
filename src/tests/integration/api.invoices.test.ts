import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceFromOrder, getInvoices, InvoicesUnavailableError, updateInvoiceStatus } from "../../services/apiInvoices";
import { createOrder, updateOrder, updateOrderStatus } from "../../services/apiOrders";
import { fake, fakeClient } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp, setDatabaseClock } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const VIN = "WVWZZZ1JZXW000001";
const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 };
const brakeCheck = { serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 2 };
const inA = { clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] };
const inB = { clientId: "client-b1", clientName: "", device: "Car", services: [{ serviceId: "service-b1", serviceName: "Beta wash", price: 15, quantity: 1 }] };
function at(instant: string) {
  vi.setSystemTime(new Date(instant));
}

function setTimeZone(workspaceId: string, timezone: string) {
  row("workspaces", workspaceId)!.timezone = timezone;
}

async function invoiceNewOrder(input = inA, workspaceId: string = WS.A) {
  const order = await createOrder(input, workspaceId);
  return createInvoiceFromOrder(String(order.id), workspaceId);
}

function invoicesIn(workspaceId: string) {
  return fake.all("invoices").filter((invoice) => invoice.workspace_id === workspaceId);
}

beforeEach(() => {
  seedCoreApp();
  vi.useFakeTimers({ toFake: ["Date"] });
  fake.signInAs(USERS.member.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("invoice numbers", () => {
  it("numbers the first two invoices of 2026 INV-2026-001 and -002 and the first invoice of 2027 INV-2027-001", async () => {
    at("2026-10-04T09:00:00Z");
    const first = await invoiceNewOrder();
    const second = await invoiceNewOrder();
    at("2027-01-01T10:00:00Z");
    const nextYear = await invoiceNewOrder();

    expect([first, second, nextYear].map((invoice) => invoice.invoiceNumber)).toEqual(["INV-2026-001", "INV-2026-002", "INV-2027-001"]);
    expect(invoicesIn(WS.A).map((invoice) => [invoice.number, invoice.created_at])).toEqual([
      ["INV-2026-001", "2026-10-04T09:00:00.000Z"],
      ["INV-2026-002", "2026-10-04T09:00:00.000Z"],
      ["INV-2027-001", "2027-01-01T10:00:00.000Z"],
    ]);
  });

  it("takes the year from the created_at the database stored, not from the device clock", async () => {
    at("2030-12-31T21:59:59Z");
    const order = await createOrder(inA, WS.A);
    setDatabaseClock("2030-12-31T22:00:03.000Z");

    const invoice = await createInvoiceFromOrder(String(order.id), WS.A);

    expect(invoice.invoiceNumber).toBe("INV-2031-001");
    expect(row("invoices", invoice.id)).toMatchObject({ number: "INV-2031-001", created_at: "2030-12-31T22:00:03.000Z" });
    expect(fake.requests.find((request) => request.table === "invoices" && request.op === "insert")?.values).not.toHaveProperty("created_at");
    expect(fake.requests.filter((request) => request.table === "invoices" && request.op === "update").map((request) => request.values)).toEqual([{ number: "INV-NEXT" }]);
  });

  it("uses the workspace time zone around New Year and falls back to Europe/Chisinau", async () => {
    fake.signInAs(USERS.owner.id);
    at("2030-12-31T21:59:59Z");
    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2030-001");
    at("2030-12-31T22:00:00Z");
    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2031-001");
    setTimeZone(WS.B, "UTC");
    expect((await invoiceNewOrder(inB, WS.B)).invoiceNumber).toBe("INV-2030-001");

    at("2034-12-31T22:30:00Z");
    setTimeZone(WS.A, "Not/AZone");
    setTimeZone(WS.B, "");
    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2035-001");
    expect((await invoiceNewOrder(inB, WS.B)).invoiceNumber).toBe("INV-2035-001");
  });

  it("continues each workspace's own counter and leaves existing invoice numbers unchanged", async () => {
    fake.signInAs(USERS.owner.id);
    fake.all("invoices").push(
      { id: "inv-a7", workspace_id: WS.A, order_id: null, client_id: "client-a1", number: "INV-2030-007", status: "sent", total: 10, created_at: "2030-03-01T10:00:00.000Z" },
      { id: "inv-a-prev", workspace_id: WS.A, order_id: null, client_id: "client-a1", number: "INV-2029-012", status: "paid", total: 10, created_at: "2029-03-01T10:00:00.000Z" },
      { id: "inv-b41", workspace_id: WS.B, order_id: null, client_id: "client-b1", number: "INV-2030-041", status: "sent", total: 10, created_at: "2030-03-01T10:00:00.000Z" },
    );
    fake.all("invoice_number_counters").push(
      { workspace_id: WS.A, year: 2030, last_number: 7 },
      { workspace_id: WS.A, year: 2029, last_number: 12 },
      { workspace_id: WS.B, year: 2030, last_number: 41 },
    );

    at("2030-06-15T09:00:00Z");
    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2030-008");
    expect((await invoiceNewOrder(inB, WS.B)).invoiceNumber).toBe("INV-2030-042");

    expect(["inv-a7", "inv-a-prev", "inv-b41"].map((id) => row("invoices", id)?.number)).toEqual(["INV-2030-007", "INV-2029-012", "INV-2030-041"]);
  });

  it("does not issue the number of a deleted invoice again, whether it was the newest or an older one", async () => {
    fake.signInAs(USERS.owner.id);
    at("2026-10-04T09:00:00Z");
    const first = await invoiceNewOrder();
    const second = await invoiceNewOrder();
    fake.tables.invoices = fake.all("invoices").filter((invoice) => invoice.id !== second.id);

    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2026-003");
    fake.tables.invoices = fake.all("invoices").filter((invoice) => invoice.id !== first.id);
    expect((await invoiceNewOrder()).invoiceNumber).toBe("INV-2026-004");
  });

  it("removes the unfinished invoice and its lines, using no number, when the number cannot be issued", async () => {
    at("2030-06-15T09:00:00Z");
    const order = await createOrder(inA, WS.A);
    fake.failNext("invoices", "update", { code: "42501", message: "An invoice number cannot be changed" });

    await expect(createInvoiceFromOrder(String(order.id), WS.A)).rejects.toThrow("An invoice number cannot be changed");
    expect(fake.all("invoices")).toEqual([]);
    expect(fake.all("invoice_items")).toEqual([]);
    expect((await createInvoiceFromOrder(String(order.id), WS.A)).invoiceNumber).toBe("INV-2030-001");
  });

  it("leaves numbering to the database: a chosen number cannot be inserted or set, and the counters are out of reach", async () => {
    at("2030-06-15T09:00:00Z");
    expect((await fakeClient.from("invoices").insert({ workspace_id: WS.A, number: "INV-2030-001", client_name: "x" })).error?.message).toBe("Invoice numbers are assigned by the database");
    const pending = (await fakeClient.from("invoices").insert({ workspace_id: WS.A, number: "INV-PENDING-x", client_name: "x" }).select("id").single()).data as { id: string };
    expect((await fakeClient.from("invoices").update({ number: "INV-2030-001" }).eq("id", pending.id)).error?.message).toBe("An invoice number cannot be changed");
    expect((await fakeClient.from("invoice_number_counters").select("*")).error?.message).toBe("permission denied for table invoice_number_counters");
  });

  it("never leaves a temporary number on a created invoice", async () => {
    at("2030-06-15T09:00:00Z");
    await invoiceNewOrder();

    expect(fake.all("invoices").map((invoice) => invoice.number)).toEqual(["INV-2030-001"]);
  });
});

describe("invoice created_at", () => {
  const insertPending = (createdAt?: string) =>
    fakeClient
      .from("invoices")
      .insert({ workspace_id: WS.A, number: `INV-PENDING-${createdAt ?? "none"}`, client_name: "x", ...(createdAt ? { created_at: createdAt } : {}) })
      .select("id, number, created_at")
      .single();
  const issue = async (invoice: { id: string; number: string }) =>
    (await fakeClient.from("invoices").update({ number: "INV-NEXT" }).eq("id", invoice.id).eq("number", invoice.number).select("number, created_at").single()).data as { number: string; created_at: string };

  beforeEach(() => {
    at("2026-10-04T09:00:00Z");
    setDatabaseClock("2026-10-04T09:00:02.000Z");
  });

  it("is stamped with the database time when the client sends none", async () => {
    const { data, error } = await insertPending();

    expect(error).toBeNull();
    expect(data).toMatchObject({ created_at: "2026-10-04T09:00:02.000Z" });
  });

  it.each([
    ["backdated", "2020-01-01T00:00:00Z"],
    ["future-dated", "2099-12-31T23:59:59Z"],
  ])("ignores a %s created_at from the client and numbers the invoice in the database's year", async (_label, createdAt) => {
    const { data, error } = await insertPending(createdAt);
    expect(error).toBeNull();
    const pending = data as { id: string; number: string; created_at: string };

    expect(pending.created_at).toBe("2026-10-04T09:00:02.000Z");
    expect(await issue(pending)).toEqual({ number: "INV-2026-001", created_at: "2026-10-04T09:00:02.000Z" });
    expect(fake.all("invoice_number_counters").map((counter) => [counter.year, counter.last_number])).toEqual([[2026, 1]]);
  });

  it("still cannot be changed after the insert", async () => {
    const pending = (await insertPending()).data as { id: string; number: string };
    const issued = await issue(pending);

    for (const createdAt of ["2020-01-01T00:00:00Z", "2099-12-31T23:59:59Z"]) {
      expect((await fakeClient.from("invoices").update({ created_at: createdAt }).eq("id", pending.id)).error?.message).toBe("created_at cannot be changed");
    }
    expect(row("invoices", pending.id)).toMatchObject({ number: issued.number, created_at: "2026-10-04T09:00:02.000Z" });
  });
});

describe("createInvoiceFromOrder", () => {
  it("copies the order's workspace, client, reference, details, service lines and totals", async () => {
    at("2026-10-04T09:00:00Z");
    const order = await createOrder({ clientId: "client-a1", clientName: "Ada Alpha", device: " Golf ", carNumber: "AB123", vin: VIN, description: "Front brakes squeak", services: [oilChange, brakeCheck] }, WS.A);

    const invoice = await createInvoiceFromOrder(String(order.id), WS.A);

    expect(invoice).toEqual({
      id: expect.any(String),
      workspaceId: WS.A,
      invoiceNumber: "INV-2026-001",
      clientId: "client-a1",
      clientName: "Ada Alpha",
      orderId: order.id,
      orderNumber: order.number,
      device: "Golf",
      carNumber: "AB123",
      vin: VIN,
      description: "Front brakes squeak",
      items: [
        { id: expect.any(String), serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 },
        { id: expect.any(String), serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 2 },
      ],
      subtotal: 90,
      total: 90,
      amount: 90,
      status: "draft",
      dueDate: "",
      createdAt: "2026-10-04",
    });
    expect(fake.all("invoice_items").map((item) => [item.invoice_id, item.service_name, item.price, item.quantity, item.position])).toEqual([
      [invoice.id, "Oil change", 40, 1, 0],
      [invoice.id, "Brake check", 25, 2, 1],
    ]);
  });

  it("keeps the invoice unchanged when the order, its services, its status and its client change later", async () => {
    row("services", "service-a2")!.status = "active";
    at("2026-10-04T09:00:00Z");
    const order = await createOrder({ ...inA, device: "Golf", carNumber: "AB123", description: "Noise" }, WS.A);
    const invoice = await createInvoiceFromOrder(String(order.id), WS.A);
    const savedInvoice = structuredClone(row("invoices", invoice.id));
    const savedItems = structuredClone(fake.all("invoice_items"));

    at("2027-02-01T09:00:00Z");
    await updateOrder({ orderId: String(order.id), device: "Passat", carNumber: "ZZ999", vin: VIN, description: "Changed", assignedEmployeeId: "", deadline: "", services: [brakeCheck] }, WS.A);
    await updateOrderStatus(String(order.id), "paid", WS.A);
    row("clients", "client-a1")!.name = "Ada Renamed";

    expect(row("orders", String(order.id))).toMatchObject({ device: "Passat", total_price: 50, status: "paid" });
    expect(row("invoices", invoice.id)).toEqual(savedInvoice);
    expect(fake.all("invoice_items")).toEqual(savedItems);
    expect(await getInvoices(WS.A)).toEqual([expect.objectContaining({ invoiceNumber: "INV-2026-001", clientName: "Ada Alpha", amount: 40, status: "draft" })]);
  });

  it("allows one invoice per order and names the existing invoice", async () => {
    at("2026-10-04T09:00:00Z");
    const order = await createOrder(inA, WS.A);
    await createInvoiceFromOrder(String(order.id), WS.A);

    await expect(createInvoiceFromOrder(String(order.id), WS.A)).rejects.toThrow("Invoice INV-2026-001 already exists for this order.");
    expect(invoicesIn(WS.A)).toHaveLength(1);
    expect(fake.all("invoice_items")).toHaveLength(1);
  });

  it("creates exactly one invoice when the same order is invoiced twice at once", async () => {
    at("2026-10-04T09:00:00Z");
    const order = await createOrder(inA, WS.A);

    const results = await Promise.allSettled([createInvoiceFromOrder(String(order.id), WS.A), createInvoiceFromOrder(String(order.id), WS.A)]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(invoicesIn(WS.A).map((invoice) => invoice.number)).toEqual(["INV-2026-001"]);
    expect(fake.all("invoice_items")).toHaveLength(1);
  });

  it("replaces an invoice whose creation was interrupted before it was numbered", async () => {
    at("2026-10-04T09:00:00Z");
    const order = await createOrder(inA, WS.A);
    fake.all("invoices").push({ id: "inv-orphan", workspace_id: WS.A, order_id: order.id, client_id: "client-a1", number: "INV-PENDING-orphan", status: "draft", total: 40, created_at: "2026-10-04T08:00:00.000Z" });
    expect(await getInvoices(WS.A)).toEqual([]);

    const invoice = await createInvoiceFromOrder(String(order.id), WS.A);

    expect(invoice.invoiceNumber).toBe("INV-2026-001");
    expect(row("invoices", "inv-orphan")).toBeUndefined();
  });

  it("removes the invoice when its lines cannot be saved", async () => {
    at("2026-10-04T09:00:00Z");
    const order = await createOrder(inA, WS.A);
    fake.failNext("invoice_items", "insert", { code: "42501", message: 'new row violates row-level security policy for table "invoice_items"' });

    await expect(createInvoiceFromOrder(String(order.id), WS.A)).rejects.toThrow('new row violates row-level security policy for table "invoice_items"');
    expect(fake.all("invoices")).toEqual([]);
    expect(fake.requests.some((request) => request.table === "invoices" && request.op === "update")).toBe(false);
    expect((await createInvoiceFromOrder(String(order.id), WS.A)).invoiceNumber).toBe("INV-2026-001");
  });

  it("refuses orders from another workspace or one the user cannot read", async () => {
    await expect(createInvoiceFromOrder("order-b1", WS.A)).rejects.toThrow("Order was not found in this workspace.");
    await expect(createInvoiceFromOrder("order-c1", WS.C)).rejects.toThrow("Order was not found in this workspace.");
    await expect(createInvoiceFromOrder("order-a1", undefined)).rejects.toThrow("No active workspace selected");
    expect(fake.all("invoices")).toEqual([]);
  });

  it("reports a clear error when the invoices tables are missing from the database", async () => {
    const missingTable = { code: "PGRST205", message: "Could not find the table 'public.invoices' in the schema cache" };
    fake.failNext("invoices", "select", missingTable);
    await expect(createInvoiceFromOrder("order-a1", WS.A)).rejects.toBeInstanceOf(InvoicesUnavailableError);

    fake.failNext("invoices", "select", missingTable);
    await expect(getInvoices(WS.A)).rejects.toThrow("Invoices are not set up in this database yet. The invoices migration has to be applied first.");
  });
});

describe("getInvoices", () => {
  it("lists only the active workspace's invoices, newest first", async () => {
    fake.signInAs(USERS.owner.id);
    at("2026-10-04T09:00:00Z");
    await invoiceNewOrder();
    await invoiceNewOrder(inB, WS.B);
    at("2026-10-05T09:00:00Z");
    await invoiceNewOrder();

    expect((await getInvoices(WS.A)).map((invoice) => invoice.invoiceNumber)).toEqual(["INV-2026-002", "INV-2026-001"]);
    expect((await getInvoices(WS.B)).map((invoice) => invoice.invoiceNumber)).toEqual(["INV-2026-001"]);
    fake.signInAs(USERS.outsider.id);
    expect(await getInvoices(WS.A)).toEqual([]);
  });
});

describe("updateInvoiceStatus", () => {
  it("marks an invoice sent, then paid with the payment time, then unpaid again", async () => {
    at("2026-10-04T09:00:00Z");
    const invoice = await invoiceNewOrder();

    expect(await updateInvoiceStatus(invoice.id, "sent", WS.A)).toMatchObject({ invoiceNumber: "INV-2026-001", status: "sent" });
    expect(row("invoices", invoice.id)).toMatchObject({ status: "sent", paid_at: null });

    at("2026-10-06T12:30:00Z");
    expect(await updateInvoiceStatus(invoice.id, "paid", WS.A)).toMatchObject({ status: "paid", paidAt: "2026-10-06" });
    expect(row("invoices", invoice.id)).toMatchObject({ status: "paid", paid_at: "2026-10-06T12:30:00.000Z" });

    expect(await updateInvoiceStatus(invoice.id, "sent", WS.A)).toMatchObject({ status: "sent" });
    expect(row("invoices", invoice.id)).toMatchObject({ status: "sent", paid_at: null });
    expect(row("invoices", invoice.id)).toMatchObject({ number: "INV-2026-001", total: 40 });
  });

  it("cannot change an invoice of another workspace", async () => {
    const invoice = await invoiceNewOrder();

    await expect(updateInvoiceStatus(invoice.id, "paid", WS.B)).rejects.toThrow("Invoice was not found or you do not have permission to change it.");
    fake.signInAs(USERS.outsider.id);
    await expect(updateInvoiceStatus(invoice.id, "paid", WS.A)).rejects.toThrow("Invoice was not found or you do not have permission to change it.");
    expect(row("invoices", invoice.id)).toMatchObject({ status: "draft", paid_at: null });
  });

  it("requires an active workspace", async () => {
    await expect(updateInvoiceStatus("any", "paid", undefined)).rejects.toThrow("No active workspace selected");
    expect(fake.requests.filter((request) => request.table === "invoices" && request.op === "update")).toHaveLength(0);
  });
});
