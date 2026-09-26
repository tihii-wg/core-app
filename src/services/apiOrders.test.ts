import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder } from "./apiOrders";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const createService = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser },
    from,
  },
}));

vi.mock("./apiClients", () => ({
  createClient,
}));

vi.mock("./apiServices", () => ({
  createService,
}));

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    like: () => Promise.resolve({ data: chain.numbers, error: null }),
    numbers: [] as { number: string }[],
    insert: (payload: unknown) => {
      chain.inserted.push(payload);
      return chain;
    },
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    inserted: [] as unknown[],
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };

  return chain;
}

const employeeId = "22222222-2222-4222-8222-222222222222";
const assignedUserId = "user-1";

describe("createOrder", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    createClient.mockReset();
    createService.mockReset();

    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("creates a missing client and service, then stores their ids on the order", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const clients = query({ data: [], error: null });
    const serviceById = query({ data: null, error: null });
    const serviceByName = query({ data: [], error: null });
    const orders = query({ data: { id: "order-1" }, error: null });
    const orderServices = query({ data: null, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const serviceQueries = [serviceById, serviceByName];

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "clients") return clients;
      if (table === "employees") return employees;
      if (table === "services") return serviceQueries.shift();
      if (table === "orders") return orders;
      if (table === "order_services") return orderServices;
      throw new Error(`Unexpected table ${table}`);
    });

    createClient.mockResolvedValue([{ id: "client-new" }]);
    createService.mockResolvedValue([{ id: "service-new", service_name: "Wheel alignment" }]);

    await createOrder({
      clientName: "Ada Lovelace",
      device: "BMW",
      carNumber: "ABC123",
      services: [{ serviceId: "temp-id", serviceName: "Wheel alignment", price: 45, quantity: 1 }],
      assignedEmployeeId: employeeId,
    });

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws-1", clientName: "Ada Lovelace" }));
    expect(createService).toHaveBeenCalledWith(expect.objectContaining({ serviceName: "Wheel alignment", price: 45, status: "active" }));
    expect(orders.inserted[0]).toEqual(
      expect.objectContaining({
        client_id: "client-new",
        assigned_to: assignedUserId,
        service_id: "service-new",
        service: "Wheel alignment",
      }),
    );
    expect(orderServices.inserted[0]).toEqual([
      expect.objectContaining({
        order_id: "order-1",
        service_id: "service-new",
        service_name: "Wheel alignment",
      }),
    ]);
  });

  it("reuses an existing client and service", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const orders = query({ data: { id: "order-1" }, error: null });
    const orderServices = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "employees") return employees;
      if (table === "services") return existingService;
      if (table === "orders") return orders;
      if (table === "order_services") return orderServices;
      throw new Error(`Unexpected table ${table}`);
    });

    await createOrder({
      clientId: "client-1",
      clientName: "Ada Lovelace",
      device: "BMW",
      services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
      assignedEmployeeId: employeeId,
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();
    expect(orders.inserted[0]).toEqual(
      expect.objectContaining({
        client_id: "client-1",
        assigned_to: assignedUserId,
        service_id: "service-1",
        service: "Oil change",
        number: `ORD-${new Date().getFullYear()}-001`,
      }),
    );
  });

  it("stores null when no employee is selected", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const orders = query({ data: { id: "order-1" }, error: null });
    const orderServices = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "services") return existingService;
      if (table === "orders") return orders;
      if (table === "order_services") return orderServices;
      throw new Error(`Unexpected table ${table}`);
    });

    await createOrder({
      clientId: "client-1",
      clientName: "Ada Lovelace",
      device: "BMW",
      services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
    });

    expect(orders.inserted[0]).toEqual(expect.objectContaining({ assigned_to: null }));
  });

  it("does not insert an employee id from outside the current workspace", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const missingEmployee = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "employees") return missingEmployee;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      createOrder({
        clientId: "client-1",
        clientName: "Ada Lovelace",
        device: "BMW",
        services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
        assignedEmployeeId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow("Selected employee was not found in this workspace");
  });

  it("does not insert an employee row id into assigned_to", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const unlinkedEmployee = query({ data: { id: employeeId, profile_id: null }, error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "employees") return unlinkedEmployee;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      createOrder({
        clientId: "client-1",
        clientName: "Ada Lovelace",
        device: "BMW",
        services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
        assignedEmployeeId: employeeId,
      }),
    ).rejects.toThrow("Selected employee is not linked to a user");
  });

  it("assigns the next order number for the current year", async () => {
    const year = new Date().getFullYear();
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const orders = query({ data: { id: "order-1" }, error: null });
    const orderServices = query({ data: null, error: null });
    orders.numbers = [{ number: `ORD-${year}-003` }, { number: "ORD-1790453886405" }, { number: `ORD-${year - 1}-012` }];

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "employees") return employees;
      if (table === "services") return existingService;
      if (table === "orders") return orders;
      if (table === "order_services") return orderServices;
      throw new Error(`Unexpected table ${table}`);
    });

    await createOrder({
      clientId: "client-1",
      clientName: "Ada Lovelace",
      device: "BMW",
      services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
      assignedEmployeeId: employeeId,
    });

    expect(orders.inserted[0]).toEqual(expect.objectContaining({ number: `ORD-${year}-004` }));
  });
});
