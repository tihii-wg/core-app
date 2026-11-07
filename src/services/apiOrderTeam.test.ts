import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOrderTeamsByOrderIds,
  mapOrderTeamDbError,
  resetOrderTeamSupport,
  resolveOrderIdsForEmployeeFilter,
  syncOrderEmployees,
} from "./apiOrderTeam";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

function chain(result: { data: unknown; error: unknown }, capture?: { inserts?: unknown[]; deletes?: unknown[]; updates?: unknown[] }) {
  const api = {
    select: () => api,
    eq: () => api,
    in: (...args: unknown[]) => {
      capture?.deletes?.push(args);
      return api;
    },
    insert: (payload: unknown) => {
      capture?.inserts?.push(payload);
      return Promise.resolve(result);
    },
    update: (payload: unknown) => {
      capture?.updates?.push(payload);
      return api;
    },
    delete: () => api,
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return api;
}

describe("mapOrderTeamDbError", () => {
  it("maps workspace mismatch errors", () => {
    expect(mapOrderTeamDbError({ message: "order_team:workspace_mismatch" })?.message).toBe("orders.errors.teamWorkspace");
    expect(mapOrderTeamDbError({ message: "order_team:technician_workspace_mismatch" })?.message).toBe(
      "orders.errors.teamWorkspace",
    );
    expect(mapOrderTeamDbError({ message: "unrelated" })).toBeNull();
  });
});

describe("loadOrderTeamsByOrderIds", () => {
  beforeEach(() => {
    from.mockReset();
    resetOrderTeamSupport();
  });

  it("maps team rows with employee names", async () => {
    from.mockReturnValue(
      chain({
        data: [
          { order_id: "o1", employee_id: "e1", role: "lead" },
          { order_id: "o1", employee_id: "e2", role: "helper" },
        ],
        error: null,
      }),
    );

    const teams = await loadOrderTeamsByOrderIds("ws", ["o1"], [
      { id: "e1", name: "Ivan" },
      { id: "e2", name: "Petr" },
    ]);

    expect(teams.get("o1")).toEqual([
      { employeeId: "e1", name: "Ivan", role: "lead" },
      { employeeId: "e2", name: "Petr", role: "helper" },
    ]);
  });

  it("returns empty map when order_employees table is missing", async () => {
    from.mockReturnValue(chain({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.order_employees'" } }));
    const teams = await loadOrderTeamsByOrderIds("ws", ["o1"], [{ id: "e1", name: "Ivan" }]);
    expect(teams.size).toBe(0);
  });
});

describe("syncOrderEmployees", () => {
  beforeEach(() => {
    from.mockReset();
    resetOrderTeamSupport();
  });

  it("inserts missing members and deletes removed ones", async () => {
    const capture = { inserts: [] as unknown[], deletes: [] as unknown[], updates: [] as unknown[] };
    let call = 0;
    from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return chain({
          data: [
            { employee_id: "ivan", role: "lead" },
            { employee_id: "old", role: "helper" },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null }, capture);
    });

    await syncOrderEmployees({
      workspaceId: "ws",
      orderId: "o1",
      assignedEmployeeId: "ivan",
      team: [{ employeeId: "petr", role: "helper" }],
      lineTechnicianIds: ["petr"],
    });

    expect(capture.deletes.length).toBeGreaterThan(0);
    expect(capture.inserts).toEqual([
      [
        {
          workspace_id: "ws",
          order_id: "o1",
          employee_id: "petr",
          role: "helper",
        },
      ],
    ]);
  });

  it("soft-fails when the table is missing", async () => {
    from.mockReturnValue(chain({ data: null, error: { code: "42P01", message: "relation order_employees does not exist" } }));
    await expect(
      syncOrderEmployees({
        workspaceId: "ws",
        orderId: "o1",
        assignedEmployeeId: "ivan",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveOrderIdsForEmployeeFilter", () => {
  beforeEach(() => {
    from.mockReset();
    resetOrderTeamSupport();
  });

  it("collects team and line order ids", async () => {
    let call = 0;
    from.mockImplementation((table: string) => {
      call += 1;
      if (table === "order_employees") {
        return chain({ data: [{ order_id: "team-1" }], error: null });
      }
      return chain({ data: [{ order_id: "line-1" }], error: null });
    });

    await expect(resolveOrderIdsForEmployeeFilter("ws", "emp-1")).resolves.toEqual({
      teamOrderIds: ["team-1"],
      lineOrderIds: ["line-1"],
    });
    expect(call).toBe(2);
  });

  it("tolerates missing technician_id column", async () => {
    from.mockImplementation((table: string) => {
      if (table === "order_employees") return chain({ data: [], error: null });
      return chain({ data: null, error: { code: "42703", message: 'column "technician_id" does not exist' } });
    });

    await expect(resolveOrderIdsForEmployeeFilter("ws", "emp-1")).resolves.toEqual({
      teamOrderIds: [],
      lineOrderIds: [],
    });
  });
});
