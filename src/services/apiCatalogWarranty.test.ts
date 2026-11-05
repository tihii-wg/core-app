import { beforeEach, describe, expect, it, vi } from "vitest";
import { createService, updateService, __resetCatalogWarrantyColumnCacheForTests } from "./apiServices";
import {
  createInventoryItem,
  toInventoryItem,
  updateInventoryItem,
  __resetCatalogWarrantyColumnCacheForTests as resetInvCache,
} from "./apiInventory";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

function recordingWrite(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "neq", "limit", "insert", "update", "maybeSingle"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = (...args: unknown[]) => {
    calls.push({ method: "maybeSingle", args });
    return Promise.resolve(result);
  };
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

describe("service catalog warranty persistence", () => {
  beforeEach(() => {
    from.mockReset();
    __resetCatalogWarrantyColumnCacheForTests();
  });

  it("saves and edits service catalog warranty settings", async () => {
    const unique = recordingWrite({ data: [], error: null });
    const createdRow = {
      id: "svc-1",
      service_name: "Oil",
      service_price: 40,
      category: "repair",
      status: "active",
      description: "",
      warranty_type: "both",
      warranty_months: 6,
      warranty_km: 10000,
    };
    const insert = recordingWrite({ data: [createdRow], error: null });
    const unique2 = recordingWrite({ data: [], error: null });
    const updatedRow = { ...createdRow, warranty_type: "duration", warranty_months: 12, warranty_km: null };
    const update = recordingWrite({ data: updatedRow, error: null });

    from.mockReturnValueOnce(unique.chain).mockReturnValueOnce(insert.chain).mockReturnValueOnce(unique2.chain).mockReturnValueOnce(update.chain);

    const created = await createService(
      {
        serviceName: "Oil",
        status: "active",
        category: "repair",
        price: 40,
        warrantyType: "both",
        warrantyMonths: 6,
        warrantyKm: 10000,
      },
      "ws-1",
    );
    expect(created[0]).toMatchObject({ warrantyType: "both", warrantyMonths: 6, warrantyKm: 10000 });
    const insertArgs = insert.calls.find((call) => call.method === "insert")?.args[0] as Record<string, unknown>[];
    expect(insertArgs[0]).toMatchObject({
      warranty_type: "both",
      warranty_months: 6,
      warranty_km: 10000,
    });

    const updated = await updateService(
      {
        serviceId: "svc-1",
        serviceName: "Oil",
        status: "active",
        category: "repair",
        price: 40,
        warrantyType: "duration",
        warrantyMonths: 12,
        warrantyKm: null,
      },
      "ws-1",
    );
    expect(updated).toMatchObject({ warrantyType: "duration", warrantyMonths: 12, warrantyKm: null });
    const updateArgs = update.calls.find((call) => call.method === "update")?.args[0] as Record<string, unknown>;
    expect(updateArgs).toMatchObject({
      warranty_type: "duration",
      warranty_months: 12,
      warranty_km: null,
    });
  });
});

describe("material catalog warranty persistence", () => {
  beforeEach(() => {
    from.mockReset();
    resetInvCache();
  });

  it("maps warranty columns from inventory rows", () => {
    expect(
      toInventoryItem({
        id: "i1",
        workspace_id: "ws",
        name: "Pad",
        sku: "P1",
        description: "",
        category: "",
        quantity: 1,
        min_quantity: 0,
        unit: "pcs",
        purchase_price: null,
        selling_price: 10,
        supplier: "",
        location: "",
        is_active: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        warranty_type: "mileage",
        warranty_months: null,
        warranty_km: 15000,
      }),
    ).toMatchObject({ warrantyType: "mileage", warrantyMonths: null, warrantyKm: 15000 });
  });

  it("saves and edits material catalog warranty settings", async () => {
    const insert = recordingWrite({ data: { id: "i1" }, error: null });
    const readCreated = recordingWrite({
      data: {
        id: "i1",
        workspace_id: "ws-1",
        name: "Pad",
        sku: "",
        description: "",
        category: "",
        quantity: 0,
        min_quantity: 10,
        unit: "pcs",
        purchase_price: null,
        selling_price: 12,
        supplier: "",
        location: "",
        is_active: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        warranty_type: "both",
        warranty_months: 12,
        warranty_km: 20000,
      },
      error: null,
    });
    const update = recordingWrite({ data: { id: "i1" }, error: null });
    const readUpdated = recordingWrite({
      data: {
        id: "i1",
        workspace_id: "ws-1",
        name: "Pad",
        sku: "",
        description: "",
        category: "",
        quantity: 0,
        min_quantity: 10,
        unit: "pcs",
        purchase_price: null,
        selling_price: 12,
        supplier: "",
        location: "",
        is_active: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        warranty_type: "none",
        warranty_months: null,
        warranty_km: null,
      },
      error: null,
    });

    from.mockReturnValueOnce(insert.chain).mockReturnValueOnce(readCreated.chain).mockReturnValueOnce(update.chain).mockReturnValueOnce(readUpdated.chain);

    const created = await createInventoryItem(
      {
        name: "Pad",
        sku: "",
        description: "",
        category: "",
        quantity: 0,
        minQuantity: 10,
        unit: "pcs",
        purchasePrice: null,
        sellingPrice: 12,
        supplier: "",
        location: "",
        isActive: true,
        warrantyType: "both",
        warrantyMonths: 12,
        warrantyKm: 20000,
      },
      "ws-1",
    );
    expect(created).toMatchObject({ warrantyType: "both", warrantyMonths: 12, warrantyKm: 20000 });
    const insertArgs = insert.calls.find((call) => call.method === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toMatchObject({
      warranty_type: "both",
      warranty_months: 12,
      warranty_km: 20000,
    });

    const updated = await updateInventoryItem(
      {
        id: "i1",
        name: "Pad",
        sku: "",
        description: "",
        category: "",
        quantity: 0,
        minQuantity: 10,
        unit: "pcs",
        purchasePrice: null,
        sellingPrice: 12,
        supplier: "",
        location: "",
        isActive: true,
        warrantyType: "none",
        warrantyMonths: null,
        warrantyKm: null,
      },
      "ws-1",
    );
    expect(updated).toMatchObject({ warrantyType: "none", warrantyMonths: null, warrantyKm: null });
    const updateArgs = update.calls.find((call) => call.method === "update")?.args[0] as Record<string, unknown>;
    expect(updateArgs).toMatchObject({
      warranty_type: "none",
      warranty_months: null,
      warranty_km: null,
    });
  });
});
