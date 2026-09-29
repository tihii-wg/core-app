import { beforeEach, describe, expect, it, vi } from "vitest";
import { createService, deleteService, getServices, updateService } from "../../services/apiServices";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const input = { serviceName: " Wheel alignment ", status: "active", price: 30, description: "" };

beforeEach(() => seedCoreApp());

describe("createService", () => {
  it.each([USERS.owner, USERS.admin])("lets the $name ($email) create a service", async (user) => {
    fake.signInAs(user.id);
    const [created] = await createService(input, WS.A);
    expect(created).toMatchObject({ service_name: "Wheel alignment", service_price: 30, description: null, workspace_id: WS.A });
  });

  it.each([USERS.manager, USERS.member])("refuses $email with a readable permission error", async (user) => {
    fake.signInAs(user.id);
    await expect(createService(input, WS.A)).rejects.toThrow("You do not have permission to create services in this workspace.");
    expect(fake.all("services").some((item) => item.service_name === "Wheel alignment")).toBe(false);
  });

  it("rejects a duplicate name in the same workspace, case-insensitively", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(createService({ ...input, serviceName: "OIL CHANGE" }, WS.A)).rejects.toThrow("service with this name is already exists");
  });

  it("allows the same name in a different workspace", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(createService({ ...input, serviceName: "Oil change" }, WS.B)).resolves.toHaveLength(1);
  });

  it("requires a workspace and surfaces non-permission errors verbatim", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(createService(input, undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("services", "insert", { code: "23514", message: "price must be positive" });
    await expect(createService(input, WS.A)).rejects.toThrow("price must be positive");
  });
});

describe("getServices", () => {
  it("lets every role read the workspace's services and nothing else", async () => {
    for (const user of [USERS.owner, USERS.admin, USERS.manager, USERS.member]) {
      fake.signInAs(user.id);
      expect((await getServices(WS.A)).map((item) => item.service_name).sort()).toEqual(["Brake check", "Oil change"]);
    }
    expect(await getServices(WS.C)).toEqual([]);
  });

  it("filters by name and category", async () => {
    fake.signInAs(USERS.owner.id);
    expect((await getServices(WS.A, "oil")).map((item) => item.service_name)).toEqual(["Oil change"]);
    expect(await getServices(WS.A, undefined, "diagnostics" as never)).toEqual([]);
  });

  it("requires a workspace and surfaces errors", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(getServices(undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("services", "select", { code: "PGRST000", message: "offline" });
    await expect(getServices(WS.A)).rejects.toThrow("offline");
  });
});

describe("updateService", () => {
  it("updates a service for an admin", async () => {
    fake.signInAs(USERS.admin.id);
    const updated = await updateService({ ...input, serviceId: "service-a1", serviceName: "Oil change XL", price: 45 }, WS.A);
    expect(updated).toMatchObject({ service_name: "Oil change XL", service_price: 45 });
    expect(row("services", "service-a1")?.workspace_id).toBe(WS.A);
  });

  it("allows keeping the same name on the edited service but not taking another service's name", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(updateService({ ...input, serviceId: "service-a1", serviceName: "Oil change" }, WS.A)).resolves.toBeTruthy();
    await expect(updateService({ ...input, serviceId: "service-a1", serviceName: "brake check" }, WS.A)).rejects.toThrow("service with this name is already exists");
  });

  it("refuses a manager and leaves the row untouched", async () => {
    fake.signInAs(USERS.manager.id);
    await expect(updateService({ ...input, serviceId: "service-a1", price: 1 }, WS.A)).rejects.toThrow("You do not have permission to edit this service.");
    expect(row("services", "service-a1")?.service_price).toBe(40);
  });

  it("cannot reach a service of another workspace", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(updateService({ ...input, serviceId: "service-c1" }, WS.A)).rejects.toThrow("You do not have permission to edit this service.");
    expect(row("services", "service-c1")?.service_name).toBe("Gamma tune");
  });

  it("requires a service id", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(updateService(input, WS.A)).rejects.toThrow("Service was not found.");
  });
});

describe("deleteService", () => {
  it("deletes an unused service for the owner", async () => {
    fake.signInAs(USERS.owner.id);
    await deleteService("service-a2", WS.A);
    expect(row("services", "service-a2")).toBeUndefined();
  });

  it("blocks deleting a service used by orders", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(deleteService("service-a1", WS.A)).rejects.toThrow("This service is used in orders and cannot be deleted. Set it to inactive instead.");
    expect(row("services", "service-a1")).toBeDefined();
  });

  it("refuses a member and another workspace's service", async () => {
    fake.signInAs(USERS.member.id);
    await expect(deleteService("service-a2", WS.A)).rejects.toThrow("You do not have permission to delete this service.");
    fake.signInAs(USERS.owner.id);
    await expect(deleteService("service-c1", WS.A)).rejects.toThrow("You do not have permission to delete this service.");
    expect(row("services", "service-a2")).toBeDefined();
    expect(row("services", "service-c1")).toBeDefined();
  });

  it("maps an RLS error on delete to the permission message", async () => {
    fake.signInAs(USERS.owner.id);
    fake.failNext("services", "delete", { code: "42501", message: "permission denied for table services" });
    await expect(deleteService("service-a2", WS.A)).rejects.toThrow("You do not have permission to delete this service.");
  });
});
