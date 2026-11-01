import { describe, expect, it } from "vitest";
import { normalizeTaxInput, pickDefaultIncludedTax, toTax, type TaxRecord } from "./apiTaxes";

const tax = (over: Partial<TaxRecord>): TaxRecord => ({
  id: "t",
  workspaceId: "ws",
  name: "VAT",
  rate: 20,
  isIncluded: true,
  isActive: true,
  ...over,
});

describe("taxes", () => {
  it("maps rows with safe defaults", () => {
    expect(toTax({ id: "1", workspace_id: "w", name: "VAT", rate: "20.000" })).toEqual({
      id: "1",
      workspaceId: "w",
      name: "VAT",
      rate: 20,
      isIncluded: true,
      isActive: true,
    });
    expect(toTax({ id: "2", workspace_id: "w", rate: "x", is_included: false, is_active: false })).toMatchObject({
      rate: 0,
      isIncluded: false,
      isActive: false,
    });
  });

  it("validates and normalises input", () => {
    expect(normalizeTaxInput({ name: " VAT ", rate: 20.00049, isIncluded: true, isActive: true })).toEqual({
      name: "VAT",
      rate: 20,
      isIncluded: true,
      isActive: true,
    });
    expect(() => normalizeTaxInput({ name: " ", rate: 20, isIncluded: true, isActive: true })).toThrow();
    expect(() => normalizeTaxInput({ name: "x", rate: -1, isIncluded: true, isActive: true })).toThrow();
    expect(() => normalizeTaxInput({ name: "x", rate: 101, isIncluded: true, isActive: true })).toThrow();
  });

  it("picks the highest active tax-included rate", () => {
    expect(pickDefaultIncludedTax([])).toBeNull();
    expect(
      pickDefaultIncludedTax([
        tax({ id: "a", rate: 8 }),
        tax({ id: "b", rate: 20 }),
        tax({ id: "c", rate: 25, isActive: false }),
        tax({ id: "d", rate: 30, isIncluded: false }),
      ])?.id,
    ).toBe("b");
  });
});
