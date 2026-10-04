import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrders, updateOrder, updateOrderStatus, yearInTimeZone } from "./apiOrders";

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

vi.mock("./apiClients", async (importOriginal) => ({
  toClientType: (await importOriginal<typeof import("./apiClients")>()).toClientType,
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
    order: () => chain,
    update: (payload: unknown) => {
      chain.updated.push(payload);
      return chain;
    },
    updated: [] as unknown[],
    in: () => chain,
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
const insertedOrder = { id: "order-1", number: "ORD-PENDING-1", created_at: "2026-10-04T09:00:00+00:00" };
const chisinau = () => query({ data: { timezone: "Europe/Chisinau" }, error: null });

describe("createOrder", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    createClient.mockReset();
    createService.mockReset();

    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("creates a missing client and service, then stores their ids on the order", async () => {
    const clients = query({ data: [], error: null });
    const serviceById = query({ data: null, error: null });
    const serviceByName = query({ data: [], error: null });
    const orders = query({ data: insertedOrder, error: null });
    const orderServices = query({ data: null, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const serviceQueries = [serviceById, serviceByName];

    from.mockImplementation((table: string) => {
      if (table === "workspaces") return chisinau();
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
    }, "ws-1");

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws-1", clientName: "Ada Lovelace" }));
    expect(createService).toHaveBeenCalledWith(expect.objectContaining({ serviceName: "Wheel alignment", price: 45, status: "active" }), "ws-1");
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
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const orders = query({ data: insertedOrder, error: null });
    const orderServices = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "workspaces") return chisinau();
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
    }, "ws-1");

    expect(createClient).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();
    expect(orders.inserted[0]).toEqual(
      expect.objectContaining({
        client_id: "client-1",
        assigned_to: assignedUserId,
        service_id: "service-1",
        service: "Oil change",
        number: expect.stringMatching(/^ORD-PENDING-/),
      }),
    );
    expect(orders.updated).toEqual([{ number: "ORD-2026-001" }]);
  });

  it("stores null when no employee is selected", async () => {
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const orders = query({ data: insertedOrder, error: null });
    const orderServices = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "workspaces") return chisinau();
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
    }, "ws-1");

    expect(orders.inserted[0]).toEqual(expect.objectContaining({ assigned_to: null }));
  });

  it("does not insert an employee id from outside the current workspace", async () => {
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const missingEmployee = query({ data: null, error: null });

    from.mockImplementation((table: string) => {
      if (table === "services") return existingService;
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
      }, "ws-1"),
    ).rejects.toThrow("Selected employee was not found in this workspace");
  });

  it("does not insert an employee row id into assigned_to", async () => {
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const unlinkedEmployee = query({ data: { id: employeeId, profile_id: null }, error: null });

    from.mockImplementation((table: string) => {
      if (table === "services") return existingService;
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
      }, "ws-1"),
    ).rejects.toThrow("Selected employee is not linked to a user");
  });

  it("refuses to create an order without an active workspace", async () => {
    await expect(
      createOrder({
        clientId: "client-1",
        clientName: "Ada Lovelace",
        device: "BMW",
        services: [{ serviceId: "service-1", serviceName: "Oil change", price: 40, quantity: 1 }],
      }, undefined),
    ).rejects.toThrow("No active workspace selected");
    expect(from).not.toHaveBeenCalled();
  });

  it("numbers the order from the created_at the database stored, in the workspace time zone", async () => {
    const existingService = query({ data: { id: "service-1", service_name: "Oil change" }, error: null });
    const employees = query({ data: { id: employeeId, profile_id: assignedUserId }, error: null });
    const orders = query({ data: { ...insertedOrder, created_at: "2026-12-31T22:30:00+00:00" }, error: null });
    const orderServices = query({ data: null, error: null });
    orders.numbers = [{ number: "ORD-2027-003" }, { number: "ORD-1790453886405" }, { number: "ORD-2026-012" }];

    from.mockImplementation((table: string) => {
      if (table === "workspaces") return chisinau();
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
    }, "ws-1");

    expect(orders.inserted[0]).not.toHaveProperty("created_at");
    expect(orders.updated).toEqual([{ number: "ORD-2027-004" }]);
  });
});

describe("yearInTimeZone", () => {
  it("reads the calendar year in the given zone, independent of the machine zone", () => {
    expect(yearInTimeZone("2026-12-31T21:59:59Z", "Europe/Chisinau")).toBe(2026);
    expect(yearInTimeZone("2026-12-31T22:00:00Z", "Europe/Chisinau")).toBe(2027);
    expect(yearInTimeZone("2026-12-31T22:00:00Z", "UTC")).toBe(2026);
    expect(yearInTimeZone("2026-12-31T12:00:00Z", "Pacific/Kiritimati")).toBe(2027);
    expect(yearInTimeZone("2026-12-31T12:00:00Z", "Pacific/Pago_Pago")).toBe(2026);
  });

  it("falls back to Europe/Chisinau when the zone is missing, blank or invalid", () => {
    for (const zone of [null, undefined, "", "  ", "Not/AZone"]) {
      expect(yearInTimeZone("2026-12-31T22:30:00Z", zone)).toBe(2027);
    }
  });
});

describe("getOrders", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns workspace orders with the client and assigned employee", async () => {
    const orders = query({
      data: [
        {
          id: "order-1",
          workspace_id: "ws-1",
          client_id: "client-1",
          number: "ORD-2026-003",
          device: "BMW",
          car_number: "ABC123",
          description: "Noise",
          status: "new",
          assigned_to: "user-1",
          deadline: "2026-10-01T00:00:00.000Z",
          total_price: 40,
          is_paid: false,
          service: "Oil change",
          created_at: "2026-09-26T10:00:00.000Z",
          updated_at: "2026-09-26T11:00:00.000Z",
          clients: { name: "Ada Lovelace" },
        },
      ],
      error: null,
    });
    const employees = query({ data: [{ id: employeeId, name: "Ada Tech", profile_id: "user-1" }], error: null });
    const orderServices = query({
      data: [{ order_id: "order-1", service_id: "service-1", service_name: "Oil change", price: 40, quantity: 1 }],
      error: null,
    });

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      if (table === "order_services") return orderServices;
      if (table === "employees") return employees;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(getOrders("ws-1")).resolves.toEqual([
      expect.objectContaining({
        id: "order-1",
        clientId: "client-1",
        clientName: "Ada Lovelace",
        orderNumber: "ORD-2026-003",
        device: "BMW",
        carNumber: "ABC123",
        service: "Oil change",
        services: [expect.objectContaining({ serviceId: "service-1", serviceName: "Oil change", price: 40 })],
        status: "new",
        assignedEmployeeId: employeeId,
        assignedEmployeeName: "Ada Tech",
        deadline: "2026-10-01",
        totalPrice: 40,
        paymentStatus: "unpaid",
      }),
    ]);
  });
});

describe("updateOrder", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("saves edited order fields for the current workspace", async () => {
    const employee = { id: employeeId, name: "Ada Tech", profile_id: "user-1" };
    const employees = query({ data: [employee], error: null });
    employees.maybeSingle = () => Promise.resolve({ data: { id: employeeId, profile_id: "user-1" }, error: null });
    const updates: unknown[] = [];
    const orders = query({
      data: {
        id: "order-1",
        client_id: "client-1",
        number: "ORD-2026-003",
        device: "Audi",
        car_number: "XYZ789",
        description: "Brake noise",
        status: "new",
        assigned_to: "user-1",
        deadline: "2026-10-02T00:00:00.000Z",
        total_price: 40,
        is_paid: false,
        service: "Oil change",
        created_at: "2026-09-26T10:00:00.000Z",
        updated_at: "2026-09-26T12:00:00.000Z",
        clients: { name: "Ada Lovelace" },
      },
      error: null,
    });
    orders.update = (payload: unknown) => {
      updates.push(payload);
      return orders;
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      if (table === "employees") return employees;
      throw new Error(`Unexpected table ${table}`);
    });

    const updated = await updateOrder({
      orderId: "order-1",
      device: " Audi ",
      carNumber: " xyz789 ",
      description: " Brake noise ",
      assignedEmployeeId: employeeId,
      deadline: "2026-10-02",
      vin: "",
    }, "ws-1");

    expect(updates[0]).toEqual({
      device: "Audi",
      car_number: "XYZ789",
      description: "Brake noise",
      assigned_to: "user-1",
      deadline: "2026-10-02T00:00:00.000Z",
    });
    expect(updated).toEqual(
      expect.objectContaining({
        device: "Audi",
        carNumber: "XYZ789",
        description: "Brake noise",
        assignedEmployeeName: "Ada Tech",
        deadline: "2026-10-02",
      }),
    );
  });

  it("stores a VIN when the orders table has no vin column", async () => {
    const employee = { id: employeeId, name: "Ada Tech", profile_id: "user-1" };
    const employees = query({ data: [employee], error: null });
    employees.maybeSingle = () => Promise.resolve({ data: { id: employeeId, profile_id: "user-1" }, error: null });
    const updates: unknown[] = [];
    const orders = query({
      data: {
        id: "order-1",
        client_id: "client-1",
        number: "ORD-2026-003",
        device: "BMW",
        employee_id: "1HGBH41JXMN109186",
        clients: { name: "Ada Lovelace" },
      },
      error: null,
    });
    orders.limit = () => Promise.resolve({ data: null, error: { code: "42703", message: "column orders.vin does not exist" } });
    orders.update = (payload: unknown) => {
      updates.push(payload);
      return orders;
    };

    from.mockImplementation((table: string) => {
      if (table === "employees") return employees;
      if (table === "orders") return orders;
      throw new Error(`Unexpected table ${table}`);
    });

    const updated = await updateOrder({
      orderId: "order-1",
      device: "BMW",
      carNumber: "ABC123",
      vin: "1hgbh41jxmn109186",
      description: "",
      assignedEmployeeId: employeeId,
      deadline: "",
    }, "ws-1");

    expect(updates[0]).toEqual(expect.objectContaining({ employee_id: "1HGBH41JXMN109186" }));
    expect(updated.vin).toBe("1HGBH41JXMN109186");
  });
});

describe("updateOrderStatus", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("marks the order paid when the status changes to paid", async () => {
    const updates: unknown[] = [];
    const orders = query({ data: [{ id: "order-1" }], error: null });
    orders.update = (payload: unknown) => {
      updates.push(payload);
      return orders;
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      throw new Error(`Unexpected table ${table}`);
    });

    await updateOrderStatus("order-1", "paid", "ws-1");

    expect(updates[0]).toEqual({ status: "paid", is_paid: true });
  });

  it("leaves payment unchanged for other statuses", async () => {
    const updates: unknown[] = [];
    const orders = query({ data: [{ id: "order-1" }], error: null });
    orders.update = (payload: unknown) => {
      updates.push(payload);
      return orders;
    };

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      throw new Error(`Unexpected table ${table}`);
    });

    await updateOrderStatus("order-1", "in-progress", "ws-1");

    expect(updates[0]).toEqual({ status: "in-progress" });
  });

  it("reports a permission error when RLS lets no row through", async () => {
    const orders = query({ data: [], error: null });

    from.mockImplementation((table: string) => {
      if (table === "orders") return orders;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(updateOrderStatus("order-1", "completed", "ws-1")).rejects.toThrow("permission");
  });
});
