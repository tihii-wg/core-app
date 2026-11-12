import { describe, expect, it } from "vitest";
import {
  mapOrderMaterialLinesForTest,
  mapOrderServiceLinesForTest,
  orderFromFullRpc,
  toOrder,
} from "./apiOrders";

const employees = [
  { id: "emp-1", name: "Ada Lead", profile_id: "prof-1" },
  { id: "emp-2", name: "Bob Tech", profile_id: null },
];

const serviceLines = [
  {
    id: "svc-line-1",
    order_id: "order-1",
    service_id: "svc-1",
    service_name: "Oil change",
    price: 40,
    quantity: 2,
    kind: "labor",
    discount_type: "percent",
    discount_value: 10,
    technician_id: "emp-2",
    warranty_months: 6,
  },
];

const materialLines = [
  {
    id: "mat-line-1",
    order_id: "order-1",
    inventory_item_id: "item-1",
    item_name: "Filter",
    price: 12,
    quantity: 1,
    quantity_issued: 1,
    quantity_returned: 0,
    supply_source: "catalog",
    warehouse_id: "wh-1",
    discount_type: "percent",
    discount_value: 5,
  },
];

const orderRow = {
  id: "order-1",
  workspace_id: "ws-1",
  client_id: "client-1",
  number: "ORD-1",
  employee_id: "emp-1",
  created_by: "user-1",
  status: "new",
  total_price: 80,
  discount_total: 9,
  is_paid: false,
  device: "BMW",
  car_number: "ABC",
  vin: "",
  description: "note",
  deadline: "2026-11-01",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T11:00:00.000Z",
  tax_invoice_number: "",
  vehicle_mileage_snapshot: 12000,
  vehicle_mileage_unit_snapshot: "km",
  custom_status_id: "status-1",
};

const fixture = {
  order: orderRow,
  client: { name: "Ada Client", client_type: "individual", phone: "+373" },
  services: serviceLines,
  materials: materialLines,
  team: [
    { employee_id: "emp-1", role: "lead", name: "Ada Lead" },
    { employee_id: "emp-2", role: "helper", name: "Bob Tech" },
  ],
  employees,
  member_names: { "user-1": "Creator Name" },
  custom_status: { id: "status-1", name: "In bay", color: "#112233" },
};

describe("orderFromFullRpc", () => {
  it("matches toOrder + shared line mappers on a fixture", () => {
    const fromRpc = orderFromFullRpc(fixture);
    const fromToOrder = toOrder(
      { ...orderRow, clients: fixture.client },
      employees,
      serviceLines,
      new Map([["user-1", "Creator Name"]]),
      materialLines,
      new Map([["status-1", { name: "In bay", color: "#112233" }]]),
      [
        { employeeId: "emp-1", role: "lead", name: "Ada Lead" },
        { employeeId: "emp-2", role: "helper", name: "Bob Tech" },
      ],
    );

    expect(fromRpc).toEqual(fromToOrder);
    expect(fromRpc.services).toEqual(mapOrderServiceLinesForTest(serviceLines, employees));
    expect(fromRpc.materials).toEqual(mapOrderMaterialLinesForTest(materialLines));
    expect(fromRpc.vehicleMileageSnapshot).toBe(12000);
    expect(fromRpc.vehicleMileageUnitSnapshot).toBe("km");
    expect(fromRpc.customStatus?.name).toBe("In bay");
    expect(fromRpc.createdByName).toBe("Creator Name");
  });

  it("unwraps nested { order: fullPayload } from material RPCs", () => {
    const nested = orderFromFullRpc({ changed: true, order: fixture });
    expect(nested.id).toBe("order-1");
    expect(nested.services).toHaveLength(1);
    expect(nested.materials).toHaveLength(1);
  });
});
