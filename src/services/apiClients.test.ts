import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_VEHICLE_SEARCH_PAGE_SIZE,
  collectVehicleMatchedClientIds,
  getClients,
  toClient,
} from "./apiClients";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
  },
}));

vi.mock("../i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

describe("client records", () => {
  it("keeps the stored individual client type", () => {
    expect(
      toClient({
        id: "client-1",
        name: "Ada Lovelace",
        client_type: "individual",
        email: "ada@example.com",
        phone: "+37361111111",
        address: "",
        balance: 0,
        created_at: "2024-07-01T10:00:00.000Z",
      }),
    ).toMatchObject({
      client_type: "individual",
      tax_id: null,
      contact_person: null,
      name: "Ada Lovelace",
    });
  });

  it("does not invent a client type when the row has none or an unknown one", () => {
    expect(toClient({ id: "client-3", name: "No Type" }).client_type).toBeNull();
    expect(toClient({ id: "client-4", name: "Odd Type", client_type: "company" }).client_type).toBeNull();
  });

  it("keeps organization tax id and contact person", () => {
    expect(
      toClient({
        id: "client-2",
        name: "Acme SRL",
        client_type: "organization",
        tax_id: "1234567",
        contact_person: "Maria Pop",
        email: "office@acme.test",
        phone: "+37362222222",
        address: "",
        balance: "0",
        created_at: "2024-07-02T10:00:00.000Z",
      }),
    ).toMatchObject({
      client_type: "organization",
      name: "Acme SRL",
      tax_id: "1234567",
      contact_person: "Maria Pop",
    });
  });
});

function clientsListChain(result: { data: unknown; error: unknown }, capture?: { orFilters: string[] }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.or = (filter: string) => {
    capture?.orFilters.push(filter);
    return chain;
  };
  // Supabase builders are thenable; await resolves `{ data, error }`.
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

type VehiclesCapture = {
  orFilters: string[];
  ranges: Array<[number, number]>;
  orders: unknown[][];
  limits: unknown[];
};

function vehiclesChain(
  result: { data: unknown; error: unknown } | ((from: number, to: number) => { data: unknown; error: unknown }),
  capture?: VehiclesCapture,
) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.or = (filter: string) => {
    capture?.orFilters.push(filter);
    return chain;
  };
  chain.order = (...args: unknown[]) => {
    capture?.orders.push(args);
    return chain;
  };
  chain.limit = (...args: unknown[]) => {
    capture?.limits.push(args);
    return Promise.resolve(typeof result === "function" ? result(0, 0) : result);
  };
  chain.range = (from: number, to: number) => {
    capture?.ranges.push([from, to]);
    return Promise.resolve(typeof result === "function" ? result(from, to) : result);
  };
  return chain;
}

function vehicleRow(
  overrides: Partial<{
    client_id: string;
    make: string;
    model: string;
    license_plate: string | null;
    vin: string | null;
  }> & { client_id: string },
) {
  return {
    make: "Generic",
    model: "Car",
    license_plate: null,
    vin: null,
    ...overrides,
  };
}

function clientsInChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.in = () => Promise.resolve(result);
  return chain;
}

describe("getClients search", () => {
  beforeEach(() => {
    from.mockReset();
  });

  function emptyCapture(): VehiclesCapture {
    return { orFilters: [], ranges: [], orders: [], limits: [] };
  }

  it("includes digit-normalized phone variants in the clients field filter", async () => {
    const capture = emptyCapture();
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        return clientsListChain(
          {
            data: [
              {
                id: "client-1",
                name: "Ada",
                phone: "+37369123456",
                email: "",
                address: "",
                balance: 0,
                created_at: "",
                client_type: "individual",
              },
            ],
            error: null,
          },
          capture,
        );
      }
      return vehiclesChain({ data: [], error: null }, capture);
    });

    const rows = await getClients("069123456", "ws-1");
    expect(rows.map((c) => c.id)).toEqual(["client-1"]);
    expect(capture.orFilters[0]).toContain("phone.ilike.%069123456%");
    expect(capture.orFilters[0]).toContain("phone.ilike.%37369123456%");
  });

  it("adds vehicle make/model and plate matches once per client", async () => {
    let clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) {
          return clientsListChain({ data: [], error: null });
        }
        return clientsInChain({
          data: [
            {
              id: "client-bmw",
              name: "Fleet Owner",
              phone: "+37361111111",
              email: "",
              address: "",
              balance: 0,
              created_at: "",
              client_type: "individual",
            },
          ],
          error: null,
        });
      }
      return vehiclesChain({
        data: [
          {
            client_id: "client-bmw",
            make: "BMW",
            model: "X5",
            license_plate: "B 111 AAA",
            vin: null,
          },
          {
            client_id: "client-bmw",
            make: "BMW",
            model: "X3",
            license_plate: "B 222 BBB",
            vin: null,
          },
          {
            client_id: "client-other-ws-should-not-appear",
            make: "Audi",
            model: "A4",
            license_plate: "ZZZ",
            vin: null,
          },
        ],
        error: null,
      });
    });

    const byMake = await getClients("BMW", "ws-1");
    expect(byMake).toHaveLength(1);
    expect(byMake[0]?.id).toBe("client-bmw");

    clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) return clientsListChain({ data: [], error: null });
        return clientsInChain({
          data: [
            {
              id: "client-toyota",
              name: "Camry Owner",
              phone: "",
              email: "",
              address: "",
              balance: 0,
              created_at: "",
              client_type: "individual",
            },
          ],
          error: null,
        });
      }
      return vehiclesChain({
        data: [
          {
            client_id: "client-toyota",
            make: "Toyota",
            model: "Camry",
            license_plate: "C 333 CCC",
            vin: null,
          },
        ],
        error: null,
      });
    });

    const byCombo = await getClients("Toyota Camry", "ws-1");
    expect(byCombo.map((c) => c.id)).toEqual(["client-toyota"]);
  });

  it("matches normalized plates and dedupes against field hits", async () => {
    const capture = emptyCapture();
    let clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) {
          return clientsListChain(
            {
              data: [
                {
                  id: "client-1",
                  name: "Already Found",
                  phone: "",
                  email: "",
                  address: "",
                  balance: 0,
                  created_at: "",
                  client_type: "individual",
                },
              ],
              error: null,
            },
            capture,
          );
        }
        return clientsInChain({ data: [], error: null });
      }
      return vehiclesChain(
        {
          data: [
            {
              client_id: "client-1",
              make: "VW",
              model: "Golf",
              license_plate: "B 123 ABC",
              vin: null,
            },
            {
              client_id: "client-2",
              make: "VW",
              model: "Polo",
              license_plate: "B-123-ABC",
              vin: null,
            },
          ],
          error: null,
        },
        capture,
      );
    });

    // First call returns client-1 from fields; vehicle also matches client-1 and client-2.
    // Re-mock second clients fetch for client-2 only.
    clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) {
          return clientsListChain({
            data: [
              {
                id: "client-1",
                name: "Already Found",
                phone: "",
                email: "",
                address: "",
                balance: 0,
                created_at: "",
                client_type: "individual",
              },
            ],
            error: null,
          });
        }
        return clientsInChain({
          data: [
            {
              id: "client-2",
              name: "Plate Only",
              phone: "",
              email: "",
              address: "",
              balance: 0,
              created_at: "",
              client_type: "individual",
            },
          ],
          error: null,
        });
      }
      return vehiclesChain({
        data: [
          {
            client_id: "client-1",
            make: "VW",
            model: "Golf",
            license_plate: "B 123 ABC",
            vin: null,
          },
          {
            client_id: "client-2",
            make: "VW",
            model: "Polo",
            license_plate: "B-123-ABC",
            vin: null,
          },
        ],
        error: null,
      });
    });

    const rows = await getClients("b123abc", "ws-1");
    expect(rows.map((c) => c.id).sort()).toEqual(["client-1", "client-2"]);
  });

  it("skips vehicle expansion when includeVehicleMatches is false", async () => {
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        return clientsListChain({
          data: [{ id: "client-1", name: "Ada", phone: "", email: "", address: "", balance: 0, created_at: "" }],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const rows = await getClients("BMW", "ws-1", "all", { includeVehicleMatches: false });
    expect(rows.map((c) => c.id)).toEqual(["client-1"]);
  });

  it("excludes soft-deleted vehicles via the vehicles query filter", async () => {
    const isArgs: unknown[] = [];
    const capture = emptyCapture();
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        return clientsListChain({ data: [], error: null });
      }
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = (...args: unknown[]) => {
        isArgs.push(args);
        return chain;
      };
      chain.or = () => chain;
      chain.order = () => chain;
      chain.range = (fromIdx: number, toIdx: number) => {
        capture.ranges.push([fromIdx, toIdx]);
        return Promise.resolve({ data: [], error: null });
      };
      return chain;
    });

    await getClients("BMW", "ws-1");
    expect(isArgs).toContainEqual(["deleted_at", null]);
    expect(capture.ranges.length).toBeGreaterThan(0);
    expect(capture.limits).toHaveLength(0);
  });

  it("uses range pagination instead of a fixed vehicle fetch limit", async () => {
    const capture = emptyCapture();
    from.mockImplementation((table: string) => {
      if (table === "clients") return clientsListChain({ data: [], error: null });
      return vehiclesChain({ data: [], error: null }, capture);
    });

    await getClients("BMW", "ws-1");
    expect(capture.limits).toHaveLength(0);
    expect(capture.ranges).toEqual([[0, CLIENT_VEHICLE_SEARCH_PAGE_SIZE - 1]]);
    expect(capture.orders[0]?.[0]).toBe("id");
  });

  it("finds a matching vehicle among the first 100 records", async () => {
    const pageSize = 100;
    const rows = Array.from({ length: 100 }, (_, i) =>
      vehicleRow({
        client_id: `filler-${i}`,
        make: "Audi",
        model: `A${i}`,
        license_plate: `X${i}`,
      }),
    );
    rows[50] = vehicleRow({
      client_id: "client-early",
      make: "BMW",
      model: "X5",
      license_plate: "B 050 BMW",
    });

    const capture = emptyCapture();
    let clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) return clientsListChain({ data: [], error: null });
        return clientsInChain({
          data: [
            {
              id: "client-early",
              name: "Early Match",
              phone: "",
              email: "",
              address: "",
              balance: 0,
              created_at: "",
              client_type: "individual",
            },
          ],
          error: null,
        });
      }
      return vehiclesChain((fromIdx, toIdx) => {
        const slice = rows.slice(fromIdx, toIdx + 1);
        return { data: slice, error: null };
      }, capture);
    });

    const { clientIds } = await collectVehicleMatchedClientIds("ws-1", "BMW", "BMW", { pageSize });
    expect(clientIds).toContain("client-early");
    expect(capture.ranges[0]).toEqual([0, pageSize - 1]);
  });

  it("finds a matching vehicle at position 101 via a second page", async () => {
    const pageSize = 100;
    const rows = Array.from({ length: 101 }, (_, i) =>
      vehicleRow({
        client_id: `filler-${i}`,
        make: "Audi",
        model: `A${i}`,
        license_plate: `X${i}`,
      }),
    );
    rows[100] = vehicleRow({
      client_id: "client-101",
      make: "BMW",
      model: "X5",
      license_plate: "B 101 BMW",
    });

    const capture = emptyCapture();
    from.mockImplementation((table: string) => {
      if (table === "clients") return clientsListChain({ data: [], error: null });
      return vehiclesChain((fromIdx, toIdx) => ({ data: rows.slice(fromIdx, toIdx + 1), error: null }), capture);
    });

    const { clientIds } = await collectVehicleMatchedClientIds("ws-1", "BMW", "BMW", { pageSize });
    expect(clientIds).toEqual(["client-101"]);
    expect(capture.ranges).toEqual([
      [0, 99],
      [100, 199],
    ]);
  });

  it("finds a matching vehicle beyond position 500 across pages", async () => {
    const pageSize = 250;
    const rows = Array.from({ length: 501 }, (_, i) =>
      vehicleRow({
        client_id: `filler-${i}`,
        make: "Audi",
        model: `A${i}`,
        license_plate: `X${i}`,
      }),
    );
    rows[500] = vehicleRow({
      client_id: "client-501",
      make: "Toyota",
      model: "Camry",
      license_plate: "T 501 CAM",
    });

    const capture = emptyCapture();
    from.mockImplementation((table: string) => {
      if (table === "clients") return clientsListChain({ data: [], error: null });
      return vehiclesChain((fromIdx, toIdx) => ({ data: rows.slice(fromIdx, toIdx + 1), error: null }), capture);
    });

    const { clientIds } = await collectVehicleMatchedClientIds("ws-1", "Toyota Camry", "Toyota Camry", {
      pageSize,
    });
    expect(clientIds).toEqual(["client-501"]);
    expect(capture.ranges.length).toBe(3);
    expect(capture.ranges[0]).toEqual([0, 249]);
    expect(capture.ranges[2]).toEqual([500, 749]);
  });

  it("finds a matching vehicle beyond position 1000 with multi-page range queries", async () => {
    const pageSize = 400;
    const matchIndex = 1000;
    const total = 1001;
    const capture = emptyCapture();

    from.mockImplementation((table: string) => {
      if (table === "clients") {
        return clientsListChain({ data: [], error: null });
      }
      return vehiclesChain((fromIdx, toIdx) => {
        const slice = [];
        for (let i = fromIdx; i <= toIdx && i < total; i += 1) {
          if (i === matchIndex) {
            slice.push(
              vehicleRow({
                client_id: "client-1001",
                make: "VW",
                model: "Golf",
                license_plate: "B 1001 ABC",
                vin: "WVWZZZ1JZXW000001",
              }),
            );
          } else {
            slice.push(
              vehicleRow({
                client_id: `filler-${i}`,
                make: "Fiat",
                model: `P${i}`,
                license_plate: `F${i}`,
              }),
            );
          }
        }
        return { data: slice, error: null };
      }, capture);
    });

    const byPlate = await collectVehicleMatchedClientIds("ws-1", "b1001abc", "b1001abc", { pageSize });
    expect(byPlate.clientIds).toEqual(["client-1001"]);

    capture.ranges.length = 0;
    const byVin = await collectVehicleMatchedClientIds("ws-1", "WVWZZZ1JZXW000001", "WVWZZZ1JZXW000001", {
      pageSize,
    });
    expect(byVin.clientIds).toEqual(["client-1001"]);
    expect(capture.ranges.length).toBeGreaterThanOrEqual(3);
    expect(capture.ranges.some(([fromIdx]) => fromIdx >= 800)).toBe(true);
  });

  it("does not return a client for a non-matching vehicle", async () => {
    from.mockImplementation((table: string) => {
      if (table === "clients") return clientsListChain({ data: [], error: null });
      return vehiclesChain({
        data: [vehicleRow({ client_id: "client-x", make: "Audi", model: "A4", license_plate: "AA 111 AA" })],
        error: null,
      });
    });

    const { clientIds } = await collectVehicleMatchedClientIds("ws-1", "BMW", "BMW");
    expect(clientIds).toEqual([]);
  });

  it("dedupes one client with many matching vehicles and merges with field hits", async () => {
    let clientsCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "clients") {
        clientsCalls += 1;
        if (clientsCalls === 1) {
          return clientsListChain({
            data: [
              {
                id: "client-both",
                name: "BMW Owner",
                phone: "",
                email: "",
                address: "",
                balance: 0,
                created_at: "",
                client_type: "individual",
              },
            ],
            error: null,
          });
        }
        return clientsInChain({
          data: [
            {
              id: "client-vehicle-only",
              name: "Plate Only",
              phone: "",
              email: "",
              address: "",
              balance: 0,
              created_at: "",
              client_type: "individual",
            },
          ],
          error: null,
        });
      }
      return vehiclesChain({
        data: [
          vehicleRow({ client_id: "client-both", make: "BMW", model: "X5", license_plate: "B 1" }),
          vehicleRow({ client_id: "client-both", make: "BMW", model: "X3", license_plate: "B 2" }),
          vehicleRow({ client_id: "client-vehicle-only", make: "BMW", model: "i4", license_plate: "B 3" }),
        ],
        error: null,
      });
    });

    const rows = await getClients("BMW", "ws-1");
    expect(rows.map((c) => c.id).sort()).toEqual(["client-both", "client-vehicle-only"]);
  });
});
