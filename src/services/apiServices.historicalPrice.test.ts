import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../tests/fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../tests/coreAppDb";
import { updateService } from "./apiServices";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

describe("catalog price updates vs order service lines", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.owner.id);
  });

  it("does not rewrite historical order_services prices when the catalog price changes", async () => {
    const lineBefore = fake.all("order_services").find((line) => line.service_id === "service-a1");
    expect(lineBefore).toMatchObject({ price: 40, service_name: "Oil change" });

    await updateService(
      {
        serviceId: "service-a1",
        serviceName: "Oil change",
        status: "active",
        category: "repair",
        price: 99,
        description: "Oil change description",
      },
      WS.A,
    );

    expect(row("services", "service-a1")).toMatchObject({ service_price: 99 });
    expect(fake.all("order_services").find((line) => line.service_id === "service-a1")).toMatchObject({
      price: 40,
      service_name: "Oil change",
    });
  });
});
