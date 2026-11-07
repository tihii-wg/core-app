import { describe, expect, it } from "vitest";
import { pickPrintCompanyPhone, type LocationRecord } from "./apiLocations";

function loc(partial: Partial<LocationRecord> & Pick<LocationRecord, "id" | "name">): LocationRecord {
  return {
    workspaceId: "ws",
    address: null,
    phone: null,
    color: null,
    code: null,
    isDefault: false,
    isActive: true,
    ...partial,
  };
}

describe("pickPrintCompanyPhone", () => {
  it("prefers the default active location phone", () => {
    expect(
      pickPrintCompanyPhone([
        loc({ id: "1", name: "A", phone: "+111", isDefault: false }),
        loc({ id: "2", name: "B", phone: "+222", isDefault: true }),
        loc({ id: "3", name: "C", phone: "+333", isDefault: false, isActive: false }),
      ]),
    ).toBe("+222");
  });

  it("falls back to the first active location when none is default", () => {
    expect(
      pickPrintCompanyPhone([
        loc({ id: "1", name: "Inactive", phone: "+000", isActive: false, isDefault: true }),
        loc({ id: "2", name: "First", phone: "+111" }),
        loc({ id: "3", name: "Second", phone: "+222" }),
      ]),
    ).toBe("+111");
  });

  it("returns null when no active location has a phone", () => {
    expect(pickPrintCompanyPhone([loc({ id: "1", name: "A", phone: "  ", isDefault: true })])).toBeNull();
    expect(pickPrintCompanyPhone([])).toBeNull();
  });
});
