import { beforeEach, describe, expect, it } from "vitest";
import { fake } from "./fakeSupabase";
import { USERS, WS, membership, seedCoreApp } from "./coreAppDb";

const db = fake.client;

describe("fake Supabase security model", () => {
  beforeEach(() => seedCoreApp());

  it("hides rows from workspaces the caller does not belong to", async () => {
    fake.signInAs(USERS.owner.id);
    const { data } = await db.from("clients").select("name");
    expect((data as { name: string }[]).map((row) => row.name).sort()).toEqual(["Ada Alpha", "Bob Beta"]);

    fake.signInAs(USERS.outsider.id);
    const { data: outsider } = await db.from("clients").select("name");
    expect(outsider).toEqual([{ name: "Gus Gamma" }]);
  });

  it("returns nothing to a signed-out caller", async () => {
    fake.signInAs(null);
    const { data } = await db.from("orders").select("*");
    expect(data).toEqual([]);
  });

  it("refuses DELETE on workspace_members and workspaces at the grant level", async () => {
    fake.signInAs(USERS.owner.id);
    for (const table of ["workspace_members", "workspaces"]) {
      const { error } = await db.from(table).delete().eq("id", "anything");
      expect(error).toMatchObject({ code: "42501", message: `permission denied for table ${table}` });
    }
  });

  it("refuses changing workspace_id or user_id of a membership", async () => {
    fake.signInAs(USERS.owner.id);
    const { error } = await db.from("workspace_members").update({ workspace_id: WS.B }).eq("workspace_id", WS.A).eq("user_id", USERS.member.id);
    expect(error?.code).toBe("42501");
    expect(membership(WS.A, USERS.member.id)?.workspace_id).toBe(WS.A);
  });

  it("lets an admin manage managers and members only", async () => {
    fake.signInAs(USERS.admin.id);
    const denied = await db.from("workspace_members").update({ role: "member" }).eq("workspace_id", WS.A).eq("user_id", USERS.owner.id).select("user_id");
    expect(denied.data).toEqual([]);
    const allowed = await db.from("workspace_members").update({ role: "member" }).eq("workspace_id", WS.A).eq("user_id", USERS.manager.id).select("user_id");
    expect(allowed.data).toEqual([{ user_id: USERS.manager.id }]);
    const promote = await db.from("workspace_members").update({ role: "admin" }).eq("workspace_id", WS.A).eq("user_id", USERS.member.id).select("user_id");
    expect(promote.error?.code).toBe("42501");
  });

  it("refuses UPDATE on order_services and keeps owner_id immutable", async () => {
    fake.signInAs(USERS.owner.id);
    expect((await db.from("order_services").update({ price: 1 }).eq("order_id", "order-a1")).error?.message).toBe("permission denied for table order_services");
    expect((await db.from("workspaces").update({ owner_id: USERS.admin.id }).eq("id", WS.A)).error?.code).toBe("42501");
  });

  it("lets only members of the order's workspace delete its order_services lines", async () => {
    fake.signInAs(USERS.outsider.id);
    const foreign = await db.from("order_services").delete().eq("id", "line-a1").select("id");
    expect(foreign).toMatchObject({ data: [], error: null });

    fake.signInAs(USERS.member.id);
    const otherWorkspace = await db.from("order_services").delete().eq("id", "line-c1").select("id");
    expect(otherWorkspace).toMatchObject({ data: [], error: null });
    const own = await db.from("order_services").delete().eq("id", "line-a1").select("id");
    expect(own.data).toEqual([{ id: "line-a1" }]);

    expect(fake.all("order_services").map((line) => line.id).sort()).toEqual(["line-b1", "line-c1"]);
    expect(fake.all("services").some((service) => service.id === "service-a1")).toBe(true);
  });

  it("allows only owners and admins to write services", async () => {
    fake.signInAs(USERS.manager.id);
    const insert = await db.from("services").insert([{ workspace_id: WS.A, service_name: "X", service_price: 1, status: "active" }]).select("*");
    expect(insert.error?.code).toBe("42501");
    const update = await db.from("services").update({ service_price: 1 }).eq("id", "service-a1").select("id");
    expect(update.data).toEqual([]);
  });
});
