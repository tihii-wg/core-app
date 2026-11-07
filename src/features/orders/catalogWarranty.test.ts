import { describe, expect, it } from "vitest";
import {
  catalogWarrantyFromDbRow,
  catalogWarrantyToDbPayload,
  normalizeCatalogWarrantyDefaults,
  resolveOrderLineWarrantyForKind,
  resolveOrderLineWarrantySnapshot,
} from "./catalogWarranty";
import { catalogServiceToOrderLine } from "../services/orderServiceLine";
import { catalogItemToOrderMaterial } from "../inventory/orderMaterialLine";
import { evaluateWarranty } from "./warranty";

const workspaceDefaults = {
  serviceDurationMonths: 3,
  serviceMileageLimit: 1000,
  partsDurationMonths: 6,
  partsMileageLimit: 5000,
};

describe("catalog warranty normalization", () => {
  it("stores none as null months/km (never zero)", () => {
    expect(normalizeCatalogWarrantyDefaults({ warrantyType: "none", warrantyMonths: 0, warrantyKm: 0 })).toEqual({
      warrantyType: "none",
      warrantyMonths: null,
      warrantyKm: null,
    });
    expect(catalogWarrantyToDbPayload({ warrantyType: "none", warrantyMonths: null, warrantyKm: null })).toEqual({
      warranty_type: "none",
      warranty_months: null,
      warranty_km: null,
    });
  });

  it("requires positive duration for duration-only", () => {
    expect(normalizeCatalogWarrantyDefaults({ warrantyType: "duration", warrantyMonths: 6 })).toEqual({
      warrantyType: "duration",
      warrantyMonths: 6,
      warrantyKm: null,
    });
    expect(() => normalizeCatalogWarrantyDefaults({ warrantyType: "duration", warrantyMonths: null })).toThrow();
  });

  it("requires positive mileage for mileage-only", () => {
    expect(normalizeCatalogWarrantyDefaults({ warrantyType: "mileage", warrantyKm: 10000 })).toEqual({
      warrantyType: "mileage",
      warrantyMonths: null,
      warrantyKm: 10000,
    });
    expect(() => normalizeCatalogWarrantyDefaults({ warrantyType: "mileage", warrantyKm: null })).toThrow();
  });

  it("requires both for combined warranty and persists both limits together", () => {
    expect(normalizeCatalogWarrantyDefaults({ warrantyType: "both", warrantyMonths: 24, warrantyKm: 20000 })).toEqual({
      warrantyType: "both",
      warrantyMonths: 24,
      warrantyKm: 20000,
    });
    expect(catalogWarrantyToDbPayload({ warrantyType: "both", warrantyMonths: 24, warrantyKm: 20000 })).toEqual({
      warranty_type: "both",
      warranty_months: 24,
      warranty_km: 20000,
    });
    expect(() => normalizeCatalogWarrantyDefaults({ warrantyType: "both", warrantyMonths: 12, warrantyKm: null })).toThrow();
  });

  it("treats unconfigured rows as null type", () => {
    expect(catalogWarrantyFromDbRow({})).toEqual({ warrantyType: null, warrantyMonths: null, warrantyKm: null });
  });

  it("keeps duration-only and mileage-only rows compatible", () => {
    expect(catalogWarrantyFromDbRow({ warranty_type: "duration", warranty_months: 12 })).toEqual({
      warrantyType: "duration",
      warrantyMonths: 12,
      warrantyKm: null,
    });
    expect(catalogWarrantyFromDbRow({ warranty_type: "mileage", warranty_km: 10000 })).toEqual({
      warrantyType: "mileage",
      warrantyMonths: null,
      warrantyKm: 10000,
    });
  });
});

describe("copy catalog warranty into order-item snapshots", () => {
  it("copies service catalog defaults into the order line", () => {
    const line = catalogServiceToOrderLine(
      {
        id: "svc-1",
        service_name: "Oil change",
        service_price: 40,
        warrantyType: "both",
        warrantyMonths: 6,
        warrantyKm: 10000,
      },
      workspaceDefaults,
    );
    expect(line).toMatchObject({
      warrantyMonths: 6,
      warrantyKm: 10000,
      warrantyDays: null,
    });
  });

  it("copies material catalog defaults into the order line", () => {
    const line = catalogItemToOrderMaterial(
      {
        id: "mat-1",
        name: "Brake pad",
        sellingPrice: 50,
        warrantyType: "both",
        warrantyMonths: 12,
        warrantyKm: 20000,
      },
      1,
      undefined,
      workspaceDefaults,
    );
    expect(line).toMatchObject({
      warrantyMonths: 12,
      warrantyKm: 20000,
      warrantyDays: null,
    });
  });

  it("keeps materials/services without warranty unassigned (explicit none)", () => {
    expect(
      catalogServiceToOrderLine(
        { id: "s", service_name: "Diag", service_price: 10, warrantyType: "none" },
        workspaceDefaults,
      ),
    ).toMatchObject({ warrantyMonths: null, warrantyKm: null });

    expect(
      catalogItemToOrderMaterial(
        { id: "m", name: "Bolt", sellingPrice: 1, warrantyType: "none" },
        1,
        undefined,
        workspaceDefaults,
      ),
    ).toMatchObject({ warrantyMonths: null, warrantyKm: null });
  });

  it("falls back to workspace defaults when catalog is unconfigured", () => {
    expect(
      catalogServiceToOrderLine({ id: "s", service_name: "Legacy", service_price: 10 }, workspaceDefaults),
    ).toMatchObject({ warrantyMonths: 3, warrantyKm: 1000 });

    expect(
      catalogItemToOrderMaterial({ id: "m", name: "Legacy", sellingPrice: 1 }, 1, undefined, workspaceDefaults),
    ).toMatchObject({ warrantyMonths: 6, warrantyKm: 5000 });
  });

  it("supports duration-only and mileage-only", () => {
    expect(
      resolveOrderLineWarrantySnapshot({ warrantyType: "duration", warrantyMonths: 6, warrantyKm: null }, null),
    ).toEqual({ warrantyMonths: 6, warrantyDays: null, warrantyKm: null });

    expect(
      resolveOrderLineWarrantySnapshot({ warrantyType: "mileage", warrantyMonths: null, warrantyKm: 10000 }, null),
    ).toEqual({ warrantyMonths: null, warrantyDays: null, warrantyKm: 10000 });
  });

  it("converts catalog km into order miles when resolving a line snapshot", () => {
    expect(
      resolveOrderLineWarrantySnapshot(
        { warrantyType: "mileage", warrantyMonths: null, warrantyKm: 50000 },
        null,
        "mi",
      ),
    ).toEqual({ warrantyMonths: null, warrantyDays: null, warrantyKm: 31069 });
    expect(
      catalogServiceToOrderLine(
        {
          id: "s",
          service_name: "Oil",
          service_price: 10,
          warrantyType: "mileage",
          warrantyMonths: null,
          warrantyKm: 50000,
        },
        null,
        "mi",
      ).warrantyKm,
    ).toBe(31069);
  });

  it("order-item override does not require mutating catalog defaults", () => {
    const catalog = { warrantyType: "both" as const, warrantyMonths: 12, warrantyKm: 20000 };
    const snapshot = resolveOrderLineWarrantyForKind(catalog, workspaceDefaults, "service");
    const overridden = { ...snapshot, warrantyMonths: 6 };

    expect(catalog.warrantyMonths).toBe(12);
    expect(overridden.warrantyMonths).toBe(6);
    expect(resolveOrderLineWarrantyForKind(catalog, workspaceDefaults, "service").warrantyMonths).toBe(12);
  });

  it("changing catalog defaults later does not rewrite an existing order snapshot object", () => {
    const catalog = { warrantyType: "duration" as const, warrantyMonths: 12, warrantyKm: null };
    const line = catalogServiceToOrderLine(
      { id: "s", service_name: "Svc", service_price: 1, ...catalog },
      workspaceDefaults,
    );
    catalog.warrantyMonths = 3;
    expect(line.warrantyMonths).toBe(12);
  });
});

describe("warranty activation remains close-only", () => {
  it("does not treat a copied snapshot as active before startsAt (create/save/payment)", () => {
    const line = resolveOrderLineWarrantySnapshot(
      { warrantyType: "both", warrantyMonths: 12, warrantyKm: 20000 },
      null,
    );
    // Catalog copy only fills line limits. Activation startsAt comes from close workflow.
    const evaluation = evaluateWarranty({
      snapshot: {
        durationMonths: line.warrantyMonths,
        mileageLimit: line.warrantyKm,
        startsAt: "2099-01-01T00:00:00.000Z",
        endsOn: "2100-01-01",
        startMileage: 1000,
        expiresAtMileage: 21000,
      },
      nowIso: "2026-11-05T00:00:00.000Z",
      currentMileage: 1000,
    });
    expect(evaluation.status).toBe("pending");
  });

  it("activates only after start (simulating successful close)", () => {
    const evaluation = evaluateWarranty({
      snapshot: {
        durationMonths: 12,
        mileageLimit: 20000,
        startsAt: "2026-11-01T00:00:00.000Z",
        endsOn: "2027-11-01",
        startMileage: 1000,
        expiresAtMileage: 21000,
      },
      nowIso: "2026-11-05T00:00:00.000Z",
      currentMileage: 1500,
    });
    expect(evaluation.status).toBe("active");
  });

  it("repeated evaluation with same start does not reset dates or mileage", () => {
    const params = {
      snapshot: {
        durationMonths: 12,
        mileageLimit: 20000,
        startsAt: "2026-11-01T00:00:00.000Z",
        endsOn: "2027-11-01",
        startMileage: 1000,
        expiresAtMileage: 21000,
      },
      nowIso: "2026-11-05T00:00:00.000Z",
      currentMileage: 1500,
    };
    const first = evaluateWarranty(params);
    const second = evaluateWarranty(params);
    expect(first).toEqual(second);
    expect(first.expiresOn).toBe("2027-11-01");
    expect(first.expiresAtMileage).toBe(21000);
  });
});
