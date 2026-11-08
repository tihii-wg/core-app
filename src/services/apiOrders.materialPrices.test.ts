import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapOrderMaterialPriceDbError } from "./apiOrders";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: {
      getUser,
      getSession: vi.fn(async () => {
        const result = await getUser();
        return { data: { session: result?.data?.user ? { user: result.data.user } : null }, error: result?.error ?? null };
      }),
    },
    from,
    rpc,
  },
}));

vi.mock("./apiClients", async (importOriginal) => ({
  toClientType: (await importOriginal<typeof import("./apiClients")>()).toClientType,
  createClient: vi.fn(),
  getClients: vi.fn(async () => []),
}));

vi.mock("./apiServices", () => ({
  createService: vi.fn(),
}));

vi.mock("./apiStatusDefinitions", () => ({
  getStatusDefinitions: vi.fn(async () => []),
  getStatusDefinitionsByIds: vi.fn(async () => new Map()),
  resolveCustomStatusForSystemStatus: vi.fn(async () => null),
}));

vi.mock("./apiClientDiscounts", () => ({
  getClientDiscounts: vi.fn(async () => ({ rows: [] })),
}));

vi.mock("./apiPayments", () => ({
  getPayments: vi.fn(async () => []),
}));

vi.mock("./apiActivityLog", () => ({
  recordActivity: vi.fn(),
}));

vi.mock("../i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

describe("mapOrderMaterialPriceDbError", () => {
  it("maps forbidden / invalid / closed errors", () => {
    expect(mapOrderMaterialPriceDbError({ message: "order_material_price:forbidden" })?.message).toBe(
      "orders.errors.materialPriceForbidden",
    );
    expect(mapOrderMaterialPriceDbError({ message: "order_material_price:invalid_price" })?.message).toBe(
      "orders.errors.materialPriceInvalid",
    );
    expect(mapOrderMaterialPriceDbError({ message: "order_lifecycle:closed_order_immutable" })?.message).toBe(
      "orders.lifecycle.errors.closedOrderImmutable",
    );
    expect(mapOrderMaterialPriceDbError({ message: "other" })).toBeNull();
  });
});

describe("createOrder / updateOrder custom catalog material prices", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("calls crm_set_order_material_prices only for catalog lines whose form price differs after sync", async () => {
    // Light integration via exported helpers is covered by map tests; exercise RPC path through updateOrder match branch.
    const { updateOrder } = await import("./apiOrders");

    const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const empId = "22222222-2222-4222-8222-222222222222";
    const lineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const itemId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const chain = (result: { data: unknown; error: unknown }, maybeSingleResult?: { data: unknown; error: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      Object.assign(api, {
        select: self,
        eq: self,
        neq: self,
        in: self,
        is: self,
        order: self,
        update: self,
        insert: self,
        delete: self,
        maybeSingle: () => Promise.resolve(maybeSingleResult ?? result),
        single: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      });
      return api;
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chain({
          data: {
            id: orderId,
            client_id: "client-1",
            status: "new",
            closed_at: null,
            number: "ORD-1",
            total_price: 100,
            is_paid: false,
            employee_id: empId,
            workspace_id: "ws-1",
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            clients: { name: "Ada" },
          },
          error: null,
        });
      }
      if (table === "employees") {
        return chain(
          { data: [{ id: empId, name: "Ivan", profile_id: null }], error: null },
          { data: { id: empId }, error: null },
        );
      }
      if (table === "order_services") {
        return chain({ data: [], error: null });
      }
      if (table === "order_materials") {
        return chain({
          data: [
            {
              id: lineId,
              order_id: orderId,
              inventory_item_id: itemId,
              item_name: "Filter",
              price: 50,
              quantity: 1,
              quantity_issued: 0,
              quantity_returned: 0,
              supply_source: "catalog",
              warehouse_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
          ],
          error: null,
        });
      }
      if (table === "order_employees") {
        return chain({ data: [], error: null });
      }
      return chain({ data: null, error: null });
    });

    rpc.mockImplementation(async (name: string) => {
      if (name === "crm_set_order_material_prices") {
        return { data: { updated: 1, total_price: 40 }, error: null };
      }
      if (name === "apply_order_material_warranties") {
        return { data: null, error: null };
      }
      if (name === "workspace_member_profiles") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });

    await updateOrder(
      {
        orderId,
        device: "Car",
        carNumber: "ABC",
        vin: "",
        description: "",
        assignedEmployeeId: empId,
        deadline: "",
        materials: [
          {
            id: lineId,
            inventoryItemId: itemId,
            itemName: "Filter",
            price: 40,
            quantity: 1,
            supplySource: "catalog",
            warehouseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
        ],
      },
      "ws-1",
    );

    const priceCalls = rpc.mock.calls.filter((call) => call[0] === "crm_set_order_material_prices");
    expect(priceCalls.length).toBeGreaterThanOrEqual(1);
    expect(priceCalls[0]?.[1]).toEqual({
      p_order_id: orderId,
      p_lines: [{ line_id: lineId, price: 40 }],
    });
  });

  it("fails loudly when material price RPC is missing and a custom catalog price was entered", async () => {
    const { updateOrder } = await import("./apiOrders");

    const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const empId = "22222222-2222-4222-8222-222222222222";
    const lineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const itemId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const chain = (result: { data: unknown; error: unknown }, maybeSingleResult?: { data: unknown; error: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      Object.assign(api, {
        select: self,
        eq: self,
        in: self,
        order: self,
        update: self,
        maybeSingle: () => Promise.resolve(maybeSingleResult ?? result),
        single: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      });
      return api;
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chain({
          data: {
            id: orderId,
            client_id: "client-1",
            status: "new",
            closed_at: null,
            number: "ORD-1",
            total_price: 100,
            is_paid: false,
            employee_id: empId,
            workspace_id: "ws-1",
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            clients: { name: "Ada" },
          },
          error: null,
        });
      }
      if (table === "employees") {
        return chain(
          { data: [{ id: empId, name: "Ivan", profile_id: null }], error: null },
          { data: { id: empId }, error: null },
        );
      }
      if (table === "order_services") return chain({ data: [], error: null });
      if (table === "order_materials") {
        return chain({
          data: [
            {
              id: lineId,
              order_id: orderId,
              inventory_item_id: itemId,
              item_name: "Filter",
              price: 50,
              quantity: 1,
              quantity_issued: 0,
              quantity_returned: 0,
              supply_source: "catalog",
              warehouse_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
          ],
          error: null,
        });
      }
      if (table === "order_employees") return chain({ data: [], error: null });
      return chain({ data: null, error: null });
    });

    rpc.mockImplementation(async (name: string) => {
      if (name === "crm_set_order_material_prices") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function crm_set_order_material_prices" } };
      }
      if (name === "apply_order_material_warranties") return { data: null, error: null };
      if (name === "workspace_member_profiles") return { data: [], error: null };
      return { data: null, error: null };
    });

    await expect(
      updateOrder(
        {
          orderId,
          device: "Car",
          carNumber: "ABC",
          vin: "",
          description: "",
          assignedEmployeeId: empId,
          deadline: "",
          materials: [
            {
              id: lineId,
              inventoryItemId: itemId,
              itemName: "Filter",
              price: 40,
              quantity: 1,
              supplySource: "catalog",
              warehouseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
          ],
        },
        "ws-1",
      ),
    ).rejects.toThrow("orders.errors.materialPriceRpcRequired");
  });
});
