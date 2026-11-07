import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chunkIdsForInFilter,
  EMPLOYEE_FILTER_ID_CHUNK,
  getOrdersPage,
  resetOrderTeamEmployeeIdsSupport,
} from "./apiOrders";
import { resetOrderTeamSupport } from "./apiOrderTeam";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } }, error: null })),
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

vi.mock("./apiPayments", () => ({
  getPayments: vi.fn(async () => []),
}));

vi.mock("./apiActivityLog", () => ({
  recordActivity: vi.fn(),
}));

type Capture = {
  containsArgs: unknown[][];
  orArgs: string[];
  eqArgs: Array<[string, unknown]>;
  rangeCalls: number;
  selectOpts: unknown[];
};

function pageQuery(result: { data: unknown; error: unknown; count?: number | null }, capture: Capture) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: (_cols: unknown, opts?: unknown) => {
      capture.selectOpts.push(opts);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      capture.eqArgs.push([col, val]);
      return chain;
    },
    contains: (...args: unknown[]) => {
      capture.containsArgs.push(args);
      return chain;
    },
    or: (filter: string) => {
      capture.orArgs.push(filter);
      return chain;
    },
    in: self,
    lt: self,
    gte: self,
    lte: self,
    neq: self,
    is: self,
    order: self,
    range: () => {
      capture.rangeCalls += 1;
      return Promise.resolve(result);
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  });
  return chain;
}

const EMP = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-07";

describe("chunkIdsForInFilter", () => {
  it("chunks unique ids at EMPLOYEE_FILTER_ID_CHUNK", () => {
    const ids = Array.from({ length: EMPLOYEE_FILTER_ID_CHUNK + 3 }, (_, i) => `id-${i}`);
    const chunks = chunkIdsForInFilter(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(EMPLOYEE_FILTER_ID_CHUNK);
    expect(chunks[1]).toHaveLength(3);
  });
});

describe("getOrdersPage employee filter via team_employee_ids", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    resetOrderTeamEmployeeIdsSupport();
    resetOrderTeamSupport();
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it("filters with .contains(team_employee_ids, [id]) and keeps exact count + range", async () => {
    const capture: Capture = { containsArgs: [], orArgs: [], eqArgs: [], rangeCalls: 0, selectOpts: [] };
    const orders = pageQuery(
      {
        data: [
          {
            id: "order-1",
            workspace_id: "ws-1",
            number: "ORD-1",
            status: "new",
            employee_id: EMP,
            total_price: 10,
            is_paid: false,
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            clients: { name: "Ada" },
          },
        ],
        error: null,
        count: 1,
      },
      capture,
    );
    const employees = {
      select: () => employees,
      eq: () => Promise.resolve({ data: [{ id: EMP, name: "Ivan", profile_id: null }], error: null }),
    };
    const orderServices = {
      select: () => orderServices,
      in: () => orderServices,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    const orderMaterials = {
      select: () => orderMaterials,
      in: () => orderMaterials,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    const orderEmployees = {
      select: () => orderEmployees,
      eq: () => orderEmployees,
      in: () => Promise.resolve({ data: [], error: null }),
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      if (table === "employees") return employees;
      if (table === "order_services") return orderServices;
      if (table === "order_materials") return orderMaterials;
      if (table === "order_employees") return orderEmployees;
      throw new Error(`Unexpected table ${table}`);
    });

    const page = await getOrdersPage("ws-1", {
      today: TODAY,
      page: 1,
      pageSize: 25,
      employeeId: EMP,
    });

    expect(capture.containsArgs).toEqual([["team_employee_ids", [EMP]]]);
    expect(capture.selectOpts[0]).toEqual({ count: "exact" });
    expect(capture.rangeCalls).toBe(1);
    expect(capture.orArgs).toEqual([]);
    expect(page.total).toBe(1);
    expect(page.orders).toHaveLength(1);
  });

  it("returns an empty page for an invalid employee id without querying orders", async () => {
    from.mockImplementation(() => {
      throw new Error("should not query");
    });

    const page = await getOrdersPage("ws-1", {
      today: TODAY,
      page: 1,
      pageSize: 25,
      employeeId: "not-a-uuid",
    });

    expect(page).toEqual({ orders: [], total: 0, page: 1, pageSize: 25, pageCount: 1 });
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to chunked id.in filters when team_employee_ids is missing", async () => {
    const capture: Capture = { containsArgs: [], orArgs: [], eqArgs: [], rangeCalls: 0, selectOpts: [] };
    let ordersCall = 0;

    const manyLineIds = Array.from({ length: EMPLOYEE_FILTER_ID_CHUNK + 2 }, (_, i) => `order-line-${i}`);

    from.mockImplementation((table: string) => {
      if (table === "orders") {
        ordersCall += 1;
        if (ordersCall === 1) {
          // First attempt used contains → PostgREST reports missing computed field.
          const failing = pageQuery(
            {
              data: null,
              error: { code: "42703", message: 'column orders.team_employee_ids does not exist' },
              count: null,
            },
            capture,
          );
          return failing;
        }
        // Retry with legacy filter.
        return pageQuery(
          {
            data: [],
            error: null,
            count: 0,
          },
          capture,
        );
      }
      if (table === "order_employees") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [{ order_id: "order-team-1" }], error: null }),
            }),
          }),
        };
      }
      if (table === "order_services") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: manyLineIds.map((order_id) => ({ order_id })), error: null }),
          }),
        };
      }
      if (table === "employees") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "order_materials") {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const page = await getOrdersPage("ws-1", {
      today: TODAY,
      page: 1,
      pageSize: 25,
      employeeId: EMP,
    });

    expect(capture.containsArgs).toEqual([["team_employee_ids", [EMP]]]);
    expect(capture.orArgs.length).toBe(1);
    const orFilter = capture.orArgs[0] ?? "";
    expect(orFilter.startsWith(`employee_id.eq.${EMP},`)).toBe(true);
    expect(orFilter).toContain("id.in.(");
    // Two chunks: 200 + 2 line ids, plus team id may merge into unique set.
    const inClauses = orFilter.match(/id\.in\.\(/g) ?? [];
    expect(inClauses.length).toBeGreaterThanOrEqual(2);
    expect(page.total).toBe(0);

    // Flag remembered: next call skips contains.
    capture.containsArgs = [];
    capture.orArgs = [];
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return pageQuery({ data: [], error: null, count: 0 }, capture);
      }
      if (table === "order_employees") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "order_services") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "employees") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "order_materials") {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await getOrdersPage("ws-1", {
      today: TODAY,
      page: 1,
      pageSize: 25,
      employeeId: EMP,
    });
    expect(capture.containsArgs).toEqual([]);
    expect(capture.eqArgs.some(([col, val]) => col === "employee_id" && val === EMP)).toBe(true);

    resetOrderTeamEmployeeIdsSupport();
  });
});
