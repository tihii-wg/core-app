import { describe, expect, it, vi } from "vitest";

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

import { mapOrderWarrantyDbError } from "./apiOrders";

describe("mapOrderWarrantyDbError", () => {
  it("maps warranty_records:snapshot_immutable to a localized Error", () => {
    const mapped = mapOrderWarrantyDbError({ message: "warranty_records:snapshot_immutable" });
    expect(mapped).toBeInstanceOf(Error);
    expect(mapped?.message).toBe("orders.warranty.errors.snapshotImmutable");
  });

  it("maps warranty_records:has_claims to a localized Error", () => {
    const mapped = mapOrderWarrantyDbError({ message: "warranty_records:has_claims" });
    expect(mapped).toBeInstanceOf(Error);
    expect(mapped?.message).toBe("orders.warranty.errors.hasClaims");
  });

  it("detects codes embedded in surrounding PostgREST / Postgres text", () => {
    expect(
      mapOrderWarrantyDbError({
        message: 'new row violates check constraint "…" ERROR: warranty_records:snapshot_immutable',
        details: "Failing row contains …",
      })?.message,
    ).toBe("orders.warranty.errors.snapshotImmutable");

    expect(
      mapOrderWarrantyDbError({
        message: "RPC failed",
        hint: "warranty_records:has_claims (claim order still linked)",
      })?.message,
    ).toBe("orders.warranty.errors.hasClaims");
  });

  it("maps order_lifecycle:closed_order_immutable", () => {
    expect(mapOrderWarrantyDbError({ message: "order_lifecycle:closed_order_immutable" })?.message).toBe(
      "orders.lifecycle.errors.closedOrderImmutable",
    );
  });

  it("returns null for unrelated errors", () => {
    expect(mapOrderWarrantyDbError({ message: "permission denied for table order_services" })).toBeNull();
    expect(mapOrderWarrantyDbError({ message: "order_delete:has_warranty_claims" })).toBeNull();
    expect(mapOrderWarrantyDbError({ message: "" })).toBeNull();
    expect(mapOrderWarrantyDbError({})).toBeNull();
  });
});
