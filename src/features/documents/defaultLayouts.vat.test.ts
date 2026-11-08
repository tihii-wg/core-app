import { describe, expect, it } from "vitest";
import { defaultActLayout, defaultInvoiceLayout, defaultWorkOrderLayout } from "./defaultLayouts";
import {
  defaultCanvasActLayout,
  defaultCanvasInvoiceLayout,
  defaultCanvasWorkOrderLayout,
} from "./canvas/defaultCanvasLayouts";
import { totalsElementHeightFitsRows } from "./canvas/tableData";
import type { TotalsRowKey } from "./layout";

function totalsKeys(rows: { key: TotalsRowKey }[]): TotalsRowKey[] {
  return rows.map((row) => row.key);
}

describe("default layouts include VAT totals rows", () => {
  it("block layouts (v2) include net / vat / grossWithVat", () => {
    for (const layout of [defaultWorkOrderLayout(), defaultActLayout(), defaultInvoiceLayout()]) {
      const totals = layout.blocks.find((block) => block.kind === "totals");
      expect(totals?.kind).toBe("totals");
      if (totals?.kind !== "totals") return;
      const keys = totalsKeys(totals.rows);
      expect(keys).toContain("net");
      expect(keys).toContain("vat");
      expect(keys).toContain("grossWithVat");
    }
  });

  it("canvas layouts (v3) include net / vat and a single Итого without grossWithVat duplicate", () => {
    for (const layout of [
      defaultCanvasWorkOrderLayout(),
      defaultCanvasActLayout(),
      defaultCanvasInvoiceLayout(),
    ]) {
      const totals = layout.elements.find((el) => el.type === "totals");
      expect(totals?.type).toBe("totals");
      if (totals?.type !== "totals") return;
      const keys = totalsKeys(totals.rows);
      expect(keys).toContain("net");
      expect(keys).toContain("vat");
      expect(keys).toContain("total");
      expect(keys).not.toContain("grossWithVat");
      expect(totalsElementHeightFitsRows(totals)).toBe(true);
    }
  });
});
