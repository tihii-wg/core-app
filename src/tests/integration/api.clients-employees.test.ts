import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, getClients, updateClient } from "../../services/apiClients";
import { createEmployee, getEmployees } from "../../services/apiEmployees";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const clientForm = { clientType: "individual" as const, clientName: "  New Person ", taxId: "", contactPerson: "", email: " new@example.com ", phone: "+37360000000", address: "", notes: "" };

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.member.id);
});

describe("createClient", () => {
  it("inserts a trimmed client in the given workspace, stamped with the current user", async () => {
    const [created] = await createClient({ workspace_id: WS.A, ...clientForm });

    expect(created).toMatchObject({ name: "New Person", email: "new@example.com", client_type: "individual", tax_id: null });
    expect(row("clients", created.id)).toMatchObject({ workspace_id: WS.A, added_by: USERS.member.id });
  });

  it("keeps organization-only fields for organizations and drops them for individuals", async () => {
    const [organization] = await createClient({ workspace_id: WS.A, ...clientForm, clientType: "organization", taxId: " 1002 ", contactPerson: " Ion " });
    const [person] = await createClient({ workspace_id: WS.A, ...clientForm, taxId: "1003", contactPerson: "Ana" });

    expect(organization).toMatchObject({ client_type: "organization", tax_id: "1002", contact_person: "Ion" });
    expect(person).toMatchObject({ tax_id: null, contact_person: null });
  });

  it("rejects a workspace the user does not belong to with the RLS error and writes nothing", async () => {
    await expect(createClient({ workspace_id: WS.C, ...clientForm })).rejects.toThrow('new row violates row-level security policy for table "clients"');
    expect(fake.all("clients").filter((item) => item.workspace_id === WS.C)).toHaveLength(1);
  });

  it("requires a session and a workspace", async () => {
    fake.signInAs(null);
    await expect(createClient({ workspace_id: WS.A, ...clientForm })).rejects.toThrow("Auth session missing!");
    fake.signInAs(USERS.member.id);
    await expect(createClient({ workspace_id: "", ...clientForm })).rejects.toThrow("No active workspace selected");
  });

  it("surfaces Supabase errors", async () => {
    fake.failNext("clients", "insert", { code: "23514", message: "check constraint failed" });
    await expect(createClient({ workspace_id: WS.A, ...clientForm })).rejects.toThrow("check constraint failed");
  });
});

describe("getClients", () => {
  it("returns only the requested workspace's clients", async () => {
    fake.signInAs(USERS.owner.id);
    expect((await getClients("", WS.A)).map((client) => client.name)).toEqual(["Ada Alpha"]);
    expect((await getClients("", WS.B)).map((client) => client.name)).toEqual(["Bob Beta"]);
    expect(fake.requests.at(-1)?.filters).toContain(`workspace_id=eq.${WS.B}`);
  });

  it("returns an empty list for a workspace the user cannot read", async () => {
    expect(await getClients("", WS.C)).toEqual([]);
  });

  it("searches name, email, phone, tax id and contact person, with PostgREST syntax characters stripped", async () => {
    await createClient({ workspace_id: WS.A, ...clientForm, clientType: "organization", clientName: "Fleet SRL", taxId: "TX-77", contactPerson: "Petru" });

    expect((await getClients("petru", WS.A)).map((client) => client.name)).toEqual(["Fleet SRL"]);
    expect((await getClients("TX-77", WS.A)).map((client) => client.name)).toEqual(["Fleet SRL"]);
    expect((await getClients("ada@", WS.A)).map((client) => client.name)).toEqual(["Ada Alpha"]);
    expect(await getClients("nobody", WS.A)).toEqual([]);

    await getClients("a,b).or(x", WS.A);
    expect(fake.requests.at(-1)?.filters.join(" ")).not.toMatch(/[,()]/);
  });

  it("filters by client type", async () => {
    await createClient({ workspace_id: WS.A, ...clientForm, clientType: "organization", clientName: "Fleet SRL" });
    expect((await getClients("", WS.A, "organization")).map((client) => client.name)).toEqual(["Fleet SRL"]);
    expect((await getClients("", WS.A, "individual")).map((client) => client.name)).toEqual(["Ada Alpha"]);
  });

  it("requires a workspace and surfaces Supabase errors", async () => {
    await expect(getClients("", undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("clients", "select", { code: "PGRST000", message: "connection lost" });
    await expect(getClients("", WS.A)).rejects.toThrow("connection lost");
  });
});

describe("updateClient", () => {
  it("updates the client inside the workspace", async () => {
    const updated = await updateClient({ clientId: "client-a1", ...clientForm, clientName: "Ada Renamed" }, WS.A);
    expect(updated.name).toBe("Ada Renamed");
    expect(row("clients", "client-a1")).toMatchObject({ name: "Ada Renamed", workspace_id: WS.A });
  });

  it("does not touch a client from another workspace, even when the id is known", async () => {
    await expect(updateClient({ clientId: "client-c1", ...clientForm }, WS.A)).rejects.toThrow("Client was not found or you do not have permission to edit it.");
    await expect(updateClient({ clientId: "client-c1", ...clientForm }, WS.C)).rejects.toThrow("Client was not found or you do not have permission to edit it.");
    expect(row("clients", "client-c1")?.name).toBe("Gus Gamma");
  });

  it("never sends workspace_id in the update payload", async () => {
    await updateClient({ clientId: "client-a1", ...clientForm }, WS.A);
    const request = fake.requests.find((item) => item.table === "clients" && item.op === "update");
    expect(request?.values).not.toHaveProperty("workspace_id");
    expect(request?.filters).toEqual(["id=eq.client-a1", `workspace_id=eq.${WS.A}`]);
  });

  it("requires a workspace and surfaces Supabase errors", async () => {
    await expect(updateClient({ clientId: "client-a1", ...clientForm }, undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("clients", "update", { code: "57014", message: "statement timeout" });
    await expect(updateClient({ clientId: "client-a1", ...clientForm }, WS.A)).rejects.toThrow("statement timeout");
  });
});

describe("employees", () => {
  const employee = { name: "Nick New", email: "nick@example.com", phone: "+37363333333", role: "technician" as const, status: "active" };

  it("creates an employee in the workspace", async () => {
    const created = await createEmployee({ ...employee, workspace_id: WS.A, profile_id: USERS.member.id });
    expect(created?.[0]).toMatchObject({ name: "Nick New", workspace_id: WS.A });
  });

  it("requires a workspace and is refused by RLS outside the user's workspaces", async () => {
    await expect(createEmployee({ ...employee })).rejects.toThrow("No active workspace");
    await expect(createEmployee({ ...employee, workspace_id: WS.C })).rejects.toThrow("row-level security");
  });

  it("lists, searches and filters employees of one workspace", async () => {
    expect((await getEmployees("", null, WS.A)).map((item) => item.name).sort()).toEqual(["Tina Tech", "Tom Tech"]);
    expect((await getEmployees("tina", null, WS.A)).map((item) => item.name)).toEqual(["Tina Tech"]);
    expect(await getEmployees("", "manager", WS.A)).toEqual([]);
    expect(await getEmployees("", null, WS.C)).toEqual([]);
  });

  it("surfaces Supabase errors and requires a workspace", async () => {
    await expect(getEmployees("", null, undefined)).rejects.toThrow("No active workspace");
    fake.failNext("employees", "select", { code: "PGRST000", message: "offline" });
    await expect(getEmployees("", null, WS.A)).rejects.toThrow("offline");
  });
});
