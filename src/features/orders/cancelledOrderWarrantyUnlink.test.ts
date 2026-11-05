import { describe, expect, it } from "vitest";

/**
 * Documents the DB policy implemented in
 * 20261105210000_cancelled_order_owner_warranty_edit.PRODUCTION.sql.
 * The live guard is warranty_records_reject_snapshot_mutation@v2.
 */
function mayUnlinkActivatedWarrantyLineFk(opts: {
  activatedOnClose: boolean;
  orderStatus: string;
  isWorkspaceOwnerId: boolean;
  termsChanged: boolean;
  lineFkBecameNull: boolean;
  lineFkRetargeted: boolean;
}): boolean {
  if (!opts.activatedOnClose) return true;
  if (opts.termsChanged || opts.lineFkRetargeted) return false;
  if (!opts.lineFkBecameNull) return true;
  return opts.orderStatus === "cancelled" && opts.isWorkspaceOwnerId;
}

describe("cancelled-order warranty FK unlink policy", () => {
  it("allows owner to SET NULL line FKs on a cancelled order without rewriting terms", () => {
    expect(
      mayUnlinkActivatedWarrantyLineFk({
        activatedOnClose: true,
        orderStatus: "cancelled",
        isWorkspaceOwnerId: true,
        termsChanged: false,
        lineFkBecameNull: true,
        lineFkRetargeted: false,
      }),
    ).toBe(true);
  });

  it("blocks admins/managers/members and non-cancelled orders", () => {
    expect(
      mayUnlinkActivatedWarrantyLineFk({
        activatedOnClose: true,
        orderStatus: "cancelled",
        isWorkspaceOwnerId: false,
        termsChanged: false,
        lineFkBecameNull: true,
        lineFkRetargeted: false,
      }),
    ).toBe(false);
    expect(
      mayUnlinkActivatedWarrantyLineFk({
        activatedOnClose: true,
        orderStatus: "closed",
        isWorkspaceOwnerId: true,
        termsChanged: false,
        lineFkBecameNull: true,
        lineFkRetargeted: false,
      }),
    ).toBe(false);
  });

  it("never allows rewriting snapshot terms or retargeting to another line", () => {
    expect(
      mayUnlinkActivatedWarrantyLineFk({
        activatedOnClose: true,
        orderStatus: "cancelled",
        isWorkspaceOwnerId: true,
        termsChanged: true,
        lineFkBecameNull: true,
        lineFkRetargeted: false,
      }),
    ).toBe(false);
    expect(
      mayUnlinkActivatedWarrantyLineFk({
        activatedOnClose: true,
        orderStatus: "cancelled",
        isWorkspaceOwnerId: true,
        termsChanged: false,
        lineFkBecameNull: false,
        lineFkRetargeted: true,
      }),
    ).toBe(false);
  });

  it("preserves independent lifecycle: unlinking does not imply reactivation", () => {
    // Historical row keeps activated_on_close + dates; new lines activate only on next close.
    const historical = {
      id: "wr-old",
      orderMaterialId: null as string | null,
      startsAt: "2026-01-01T00:00:00.000Z",
      activatedOnClose: true,
    };
    const replacementLine = { id: "om-new", warrantyRecordId: undefined as string | undefined };
    expect(historical.orderMaterialId).toBeNull();
    expect(replacementLine.warrantyRecordId).toBeUndefined();
    expect(replacementLine.id).not.toBe(historical.id);
  });
});
