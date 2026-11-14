import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
    rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }),
    },
  },
}));

vi.mock("./apiActivityLog", () => ({
  recordActivity: vi.fn(async () => undefined),
}));

import { GET_ORDER_FULL_RPC, resetOrderMileageSnapshotSupport, updateOrderFields } from "./apiOrders";

type Result = { data: unknown; error: unknown };

type Recorder = {
  /** Payloads sent to `orders.update(...)`, in order. */
  updates: Record<string, unknown>[];
  /** `.eq(column, value)` filters applied to each update. */
  updateFilters: Array<Array<[string, unknown]>>;
  /** Write operations that must never happen (insert / delete / upsert). */
  forbiddenWrites: string[];
  tables: string[];
};

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    workspace_id: "ws-1",
    client_id: "client-1",
    number: "ORD-1",
    device: "BMW",
    car_number: "",
    vin: "",
    service: "",
    description: "Noise",
    status: "new",
    total_price: 100,
    is_paid: false,
    deadline: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    clients: { name: "Ada", client_type: null, phone: "" },
    ...overrides,
  };
}

/**
 * Chainable supabase stub. `orders`:
 *  - `.select(cols).eq().eq().maybeSingle()` → `existing` (closed-state check)
 *  - `.update(payload).eq().eq().select().maybeSingle()` → next queued update result
 *  - `.select(cols).eq().eq().limit()` (getOrder) → hydrated row
 * Every other table resolves to an empty list.
 */
function installSupabase(options: {
  existing?: Record<string, unknown>;
  hydrated?: Record<string, unknown>;
  updateResults?: Result[];
}): Recorder {
  const recorder: Recorder = { updates: [], updateFilters: [], forbiddenWrites: [], tables: [] };
  const updateResults = [...(options.updateResults ?? [])];
  const existing = options.existing ?? { client_id: "client-1", status: "new", closed_at: null };
  const hydrated = options.hydrated ?? orderRow();

  from.mockImplementation((table: string) => {
    recorder.tables.push(table);
    let isUpdate = false;
    let filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.order = self;
    chain.in = self;
    chain.is = self;
    chain.neq = self;
    chain.limit = self;
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };
    chain.update = (payload: Record<string, unknown>) => {
      isUpdate = true;
      recorder.updates.push(payload);
      filters = [];
      return chain;
    };
    for (const op of ["insert", "delete", "upsert"]) {
      chain[op] = () => {
        recorder.forbiddenWrites.push(`${table}.${op}`);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      if (table === "orders" && isUpdate) {
        recorder.updateFilters.push(filters);
        return Promise.resolve(updateResults.shift() ?? { data: { id: "order-1" }, error: null });
      }
      if (table === "orders") return Promise.resolve({ data: existing, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    chain.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: table === "orders" ? [hydrated] : [], error: null }).then(onFulfilled, onRejected);
    return chain;
  });

  return recorder;
}

describe("updateOrderFields", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    resetOrderMileageSnapshotSupport();
  });

  it("updates only the provided columns, scoped by id and workspace", async () => {
    const recorder = installSupabase({ hydrated: orderRow({ description: "New text" }) });

    const order = await updateOrderFields(
      "order-1",
      { description: "  New text ", deadline: "2026-12-24", carNumber: "abc 123", vin: "1hgbh41jxmn109186" },
      "ws-1",
    );

    expect(recorder.updates).toEqual([
      {
        description: "New text",
        deadline: "2026-12-24T00:00:00.000Z",
        car_number: "ABC 123",
        vin: "1HGBH41JXMN109186",
      },
    ]);
    expect(recorder.updateFilters[0]).toEqual([
      ["id", "order-1"],
      ["workspace_id", "ws-1"],
    ]);
    expect(order.id).toBe("order-1");
    expect(order.description).toBe("New text");
  });

  it("does not write columns that were not provided (no industry / mileage / device resets)", async () => {
    const recorder = installSupabase({});

    await updateOrderFields("order-1", { deviceSerial: "", installationAt: "2026-11-20T14:00:00.000Z" }, "ws-1");

    expect(recorder.updates).toEqual([{ device_serial: null, installation_at: "2026-11-20T14:00:00.000Z" }]);
    const payload = recorder.updates[0];
    for (const column of [
      "description",
      "deadline",
      "device",
      "car_number",
      "vin",
      "employee_id",
      "vehicle_id",
      "device_imei",
      "measurement_at",
      "vehicle_mileage_snapshot",
      "vehicle_mileage_unit_snapshot",
    ]) {
      expect(payload).not.toHaveProperty(column);
    }
  });

  it("clears a field with null / empty values", async () => {
    const recorder = installSupabase({});

    await updateOrderFields("order-1", { description: null, deadline: "", vin: "   ", measurementAt: null }, "ws-1");

    expect(recorder.updates).toEqual([{ description: null, deadline: null, vin: null, measurement_at: null }]);
  });

  it("never syncs services, materials, warehouse stock or team", async () => {
    const recorder = installSupabase({});

    await updateOrderFields("order-1", { description: "x", devicePasscode: "1234" }, "ws-1");

    // getOrder may probe crm_get_order_full for hydration; no mutation / stock / team RPCs.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(GET_ORDER_FULL_RPC, { p_order_id: "order-1" });
    expect(recorder.forbiddenWrites).toEqual([]);
    // Lines / materials / team are only read to hydrate the returned order.
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.tables.filter((table) => table === "orders")).toHaveLength(3); // existing check, update, hydrate
    expect(recorder.tables).not.toContain("inventory_movements");
  });

  it("rejects an invalid VIN before touching the database", async () => {
    const recorder = installSupabase({});

    await expect(updateOrderFields("order-1", { vin: "SHORT" }, "ws-1")).rejects.toThrow(/VIN must contain exactly 17/);

    expect(recorder.updates).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses to edit a closed order", async () => {
    const recorder = installSupabase({
      existing: { client_id: "client-1", status: "closed", closed_at: "2026-11-01T10:00:00.000Z" },
    });

    await expect(updateOrderFields("order-1", { description: "x" }, "ws-1")).rejects.toThrow(/closed/i);

    expect(recorder.updates).toEqual([]);
  });

  it("fails when the order is not visible in this workspace", async () => {
    const recorder = installSupabase({});
    from.mockImplementationOnce(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return chain;
    });

    await expect(updateOrderFields("order-x", { description: "x" }, "ws-1")).rejects.toThrow();
    expect(recorder.updates).toEqual([]);
  });

  it("requires a workspace", async () => {
    installSupabase({});
    await expect(updateOrderFields("order-1", { description: "x" }, undefined)).rejects.toThrow();
  });

  it("writes the mileage snapshot and keeps the stored unit when no unit is provided", async () => {
    const recorder = installSupabase({});

    await updateOrderFields("order-1", { vehicleMileageSnapshot: 85500 }, "ws-1");
    await updateOrderFields("order-1", { vehicleMileageSnapshot: 90000, vehicleMileageUnitSnapshot: "mi" }, "ws-1");

    expect(recorder.updates).toEqual([
      { vehicle_mileage_snapshot: 85500 },
      { vehicle_mileage_snapshot: 90000, vehicle_mileage_unit_snapshot: "mi" },
    ]);
  });

  it("retries without snapshot columns when they are missing in the database", async () => {
    const recorder = installSupabase({
      updateResults: [
        { data: null, error: { code: "42703", message: 'column "vehicle_mileage_snapshot" of relation "orders" does not exist' } },
        { data: { id: "order-1" }, error: null },
      ],
    });

    const order = await updateOrderFields(
      "order-1",
      { description: "kept", vehicleMileageSnapshot: 1000, vehicleMileageUnitSnapshot: "km" },
      "ws-1",
    );

    expect(recorder.updates).toEqual([
      { description: "kept", vehicle_mileage_snapshot: 1000, vehicle_mileage_unit_snapshot: "km" },
      { description: "kept" },
    ]);
    expect(order.id).toBe("order-1");
  });

  it("skips the write entirely when only unsupported snapshot columns were requested", async () => {
    const recorder = installSupabase({
      updateResults: [
        { data: null, error: { code: "PGRST204", message: "Could not find the 'vehicle_mileage_snapshot' column of 'orders' in the schema cache" } },
      ],
    });

    const order = await updateOrderFields("order-1", { vehicleMileageSnapshot: 1000 }, "ws-1");

    expect(recorder.updates).toEqual([{ vehicle_mileage_snapshot: 1000 }]);
    expect(order.id).toBe("order-1");
  });

  it("maps the install-after-measure constraint to friendly copy", async () => {
    installSupabase({
      updateResults: [{ data: null, error: { message: 'violates check constraint "orders_install_after_measure"' } }],
    });

    await expect(
      updateOrderFields("order-1", { installationAt: "2026-11-01T10:00:00.000Z" }, "ws-1"),
    ).rejects.toThrow("Installation must be on or after the measurement date and time.");
  });
});
