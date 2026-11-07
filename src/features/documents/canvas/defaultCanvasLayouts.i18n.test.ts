import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import {
  defaultCanvasActLayout,
  defaultCanvasInvoiceLayout,
  defaultCanvasWorkOrderLayout,
} from "./defaultCanvasLayouts";

const ENGLISH_LABELS = [
  "Client",
  "Vehicle",
  "Executor",
  "Customer",
  "Bill to",
  "Details",
  "Services",
  "Materials",
  "Discount",
  "Total",
  "Subtotal",
  "WORK ORDER",
  "INVOICE",
  "ACT OF COMPLETED WORKS",
] as const;

function collectText(layout: ReturnType<typeof defaultCanvasWorkOrderLayout>): string[] {
  const texts: string[] = [];
  for (const el of layout.elements) {
    if (el.type === "text" && typeof el.content === "string") texts.push(el.content);
    if (el.type === "signatures") {
      texts.push(...el.labels);
      if (el.dateLabel) texts.push(el.dateLabel);
    }
    if (el.type === "totals") {
      for (const row of el.rows) texts.push(row.label);
    }
    if (el.type === "table") {
      for (const column of el.columns) texts.push(column.label);
    }
    if (el.type === "pageNumber" && el.format) texts.push(el.format);
  }
  return texts;
}

describe("defaultCanvasLayouts localization", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
  });

  it("uses Russian labels for work order / act / invoice defaults (no English list labels)", () => {
    const t = i18n.t.bind(i18n);
    const blobs = [
      ...collectText(defaultCanvasWorkOrderLayout(t)),
      ...collectText(defaultCanvasActLayout(t)),
      ...collectText(defaultCanvasInvoiceLayout(t)),
    ].join("\n");

    for (const label of ENGLISH_LABELS) {
      expect(blobs.includes(label), `unexpected English label "${label}"`).toBe(false);
    }

    expect(blobs).toContain("Клиент");
    expect(blobs).toContain("Автомобиль");
    expect(blobs).toContain("Исполнитель");
    expect(blobs).toContain("Заказчик");
    expect(blobs).toContain("Итого");
    expect(blobs).toContain("Дата");
  });
});
