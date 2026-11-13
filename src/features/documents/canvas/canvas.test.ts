import { describe, expect, it } from "vitest";
import { themeRef } from "../colorRef";
import { defaultWorkOrderLayout } from "../defaultLayouts";
import { emptyPrintContext } from "../templateVariables";
import { convertBlocksLayoutToCanvas } from "./convertToCanvas";
import { createCanvasElementFromPalette } from "./createElement";
import { defaultCanvasInvoiceLayout, defaultCanvasWorkOrderLayout } from "./defaultCanvasLayouts";
import { isCanvasDocumentLayout, parseCanvasDocumentLayout } from "./guards";
import { applyTableGrowthShifts, renderCanvasLayoutToHtmlSync } from "./renderCanvasLayout";
import { snapBox, snapValue } from "./snap";
import { createHistory, pushHistory, redoHistory, undoHistory } from "./history";
import type { CanvasDocumentLayout } from "./types";

describe("canvas layout guards", () => {
  it("accepts default canvas templates", () => {
    expect(isCanvasDocumentLayout(defaultCanvasWorkOrderLayout())).toBe(true);
    expect(isCanvasDocumentLayout(defaultCanvasInvoiceLayout())).toBe(true);
    expect(parseCanvasDocumentLayout(defaultCanvasWorkOrderLayout())?.version).toBe(3);
  });

  it("rejects non-hex colors and out-of-range opacity", () => {
    const base = defaultCanvasWorkOrderLayout();
    expect(
      isCanvasDocumentLayout({
        ...base,
        page: { ...base.page, background: { color: "#fff" } },
      }),
    ).toBe(false);
    expect(
      isCanvasDocumentLayout({
        ...base,
        page: { ...base.page, background: { color: "#ffffff", opacity: Number.NaN } },
      }),
    ).toBe(false);
    expect(
      isCanvasDocumentLayout({
        ...base,
        elements: [
          {
            ...base.elements[0],
            style: { ...base.elements[0].style, color: "red" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("clamps opacity via parse when valid 0–1", () => {
    const layout = {
      ...defaultCanvasWorkOrderLayout(),
      page: {
        size: "A4" as const,
        orientation: "portrait" as const,
        marginsMm: 10,
        background: { color: "#ffffff", opacity: 0.5 },
      },
    };
    expect(isCanvasDocumentLayout(layout)).toBe(true);
  });
});

describe("renderCanvasLayoutToHtmlSync", () => {
  it("places elements in mm and outputs print-color-adjust backgrounds", () => {
    const html = renderCanvasLayoutToHtmlSync(defaultCanvasWorkOrderLayout(), emptyPrintContext({ locale: "en" }), {
      colors: {
        primary: "#1a6de0",
        primaryDark: "#1e3a8a",
        tint: "#eff6ff",
        muted: "#64748b",
        text: "#1f2933",
        border: "#e5e7eb",
      },
    });
    expect(html).toContain("print-color-adjust:exact");
    expect(html).toContain("-webkit-print-color-adjust:exact");
    expect(html).toMatch(/left:\d+(\.\d+)?mm/);
    expect(html).toContain("#1a6de0");
  });

  it("recolors theme refs from the style palette", () => {
    const html = renderCanvasLayoutToHtmlSync(defaultCanvasWorkOrderLayout(), emptyPrintContext(), {
      colors: {
        primary: "#abcdef",
        primaryDark: "#123456",
        tint: "#f0f0f0",
        muted: "#999999",
        text: "#111111",
        border: "#cccccc",
      },
    });
    expect(html).toContain("#abcdef");
  });

  it("escapes text content", () => {
    const layout = defaultCanvasWorkOrderLayout();
    const textEl = layout.elements.find((el) => el.type === "text");
    if (textEl && textEl.type === "text") textEl.content = `<script>alert(1)</script>`;
    const html = renderCanvasLayoutToHtmlSync(layout, emptyPrintContext());
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("table growth", () => {
  it("shifts elements below a grown table", () => {
    const layout: CanvasDocumentLayout = {
      version: 3,
      mode: "canvas",
      page: { size: "A4", orientation: "portrait", marginsMm: 10 },
      gridMm: 2,
      elements: [
        {
          id: "t1",
          type: "table",
          xMm: 0,
          yMm: 20,
          wMm: 190,
          hMm: 20,
          zIndex: 1,
          source: "services",
          columns: [{ key: "name", label: "Name", enabled: true }],
          showTotalsRow: false,
          headerBackground: themeRef("primary"),
          headerTextColor: "#ffffff",
          borderColor: themeRef("border"),
          borders: "all",
          style: {
            fontSizePt: 10,
            color: themeRef("text"),
            align: "left",
            paddingMm: 0,
          },
        },
        {
          id: "below",
          type: "text",
          xMm: 0,
          yMm: 45,
          wMm: 50,
          hMm: 10,
          zIndex: 1,
          content: "below",
          style: { fontSizePt: 10, color: "#111111", align: "left", paddingMm: 1 },
        },
      ],
    };
    const ctx = emptyPrintContext({
      order: {
        id: "o1",
        clientId: "c1",
        clientName: "Ada",
        orderNumber: "1",
        device: "",
        vin: "",
        carNumber: "",
        service: "",
        services: Array.from({ length: 8 }, (_, i) => ({
          id: `s${i}`,
          serviceId: `sid${i}`,
          serviceName: `S${i}`,
          price: 10,
          quantity: 1,
          kind: "service" as const,
        })),
        materials: [],
        description: "",
        status: "new",
        assignedEmployeeId: "",
        assignedEmployeeName: "",
        deadline: "",
        totalPrice: 80,
        isPaid: false,
        paymentStatus: "unpaid",
        createdAt: "",
        updatedAt: "",
      },
    });
    const placed = applyTableGrowthShifts(layout.elements, ctx);
    const below = placed.find((p) => p.element.id === "below");
    expect(below?.yMm).toBeGreaterThan(45);
  });
});

describe("defaults and convert", () => {
  it("default templates include blue header band and blue grand total", () => {
    const wo = defaultCanvasWorkOrderLayout();
    expect(wo.elements.some((el) => el.type === "rect" && el.fill?.color === themeRef("primary"))).toBe(true);
    expect(
      wo.elements.some((el) => el.type === "totals" && el.grandTotalBackground === themeRef("primary")),
    ).toBe(true);
    const inv = defaultCanvasInvoiceLayout();
    expect(inv.elements.some((el) => el.type === "rect" && el.fill?.color === themeRef("primary"))).toBe(true);
  });

  it("converts v2 blocks top-to-bottom into canvas", () => {
    const canvas = convertBlocksLayoutToCanvas(defaultWorkOrderLayout());
    expect(isCanvasDocumentLayout(canvas)).toBe(true);
    expect(canvas.elements.length).toBeGreaterThan(0);
    const ys = canvas.elements.map((el) => el.yMm);
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys));
  });
});

describe("save/reopen round trip", () => {
  it("keeps content-relative positions through parse and print HTML", () => {
    const layout = defaultCanvasWorkOrderLayout();
    const corners: CanvasDocumentLayout = {
      ...layout,
      elements: [
        {
          id: "tl",
          type: "rect",
          xMm: 0,
          yMm: 0,
          wMm: 20,
          hMm: 10,
          zIndex: 1,
          fill: { color: "#111111" },
          radiusMm: 2,
          style: { fontSizePt: 10, color: "#111111", align: "left", paddingMm: 0, radiusMm: 2 },
        },
        {
          id: "center",
          type: "text",
          xMm: 70,
          yMm: 120,
          wMm: 50,
          hMm: 12,
          zIndex: 2,
          content: "Center",
          style: {
            fontSizePt: 14,
            color: "#111111",
            align: "center",
            verticalAlign: "middle",
            paddingMm: 1,
            radiusMm: 1.5,
          },
        },
      ],
    };

    const parsed = parseCanvasDocumentLayout(JSON.parse(JSON.stringify(corners)));
    expect(parsed).not.toBeNull();
    expect(parsed?.elements.find((el) => el.id === "tl")).toMatchObject({ xMm: 0, yMm: 0, radiusMm: 2 });
    expect(parsed?.elements.find((el) => el.id === "center")).toMatchObject({
      xMm: 70,
      yMm: 120,
      style: expect.objectContaining({ fontSizePt: 14, verticalAlign: "middle", radiusMm: 1.5 }),
    });

    const html = renderCanvasLayoutToHtmlSync(parsed!, emptyPrintContext({ locale: "en" }));
    expect(html).toMatch(/data-el="tl"[^>]*left:0mm/);
    expect(html).toMatch(/data-el="tl"[^>]*top:0mm/);
    expect(html).toMatch(/data-el="center"[^>]*left:70mm/);
    expect(html).toMatch(/data-el="center"[^>]*top:120mm/);
    expect(html).toContain("font-size:14pt");
    expect(html).toContain("border-radius:2mm");
    expect(html).toContain("justify-content:center");
    expect(html).toContain('text-align:center');
  });
});

describe("designer helpers", () => {
  it("creates an element at the drop position from the palette", () => {
    const el = createCanvasElementFromPalette({ kind: "variable", token: "#АВТО-VIN", label: "VIN" }, 12, 34);
    expect(el.type).toBe("variable");
    expect(el.xMm).toBe(12);
    expect(el.yMm).toBe(34);
    if (el.type === "variable") expect(el.token).toBe("#АВТО-VIN");
  });

  it("snaps move/resize to grid and other edges", () => {
    expect(snapValue(10.4, 2, true)).toBe(10);
    const snapped = snapBox(
      { xMm: 20.2, yMm: 30.1, wMm: 40, hMm: 10 },
      [{ id: "a", type: "text", xMm: 20, yMm: 50, wMm: 10, hMm: 10, zIndex: 1, content: "", style: { fontSizePt: 10, color: "#000000", align: "left", paddingMm: 0 } }],
      2,
      true,
    );
    expect(snapped.xMm % 2).toBe(0);
  });

  it("supports undo/redo history", () => {
    const a = defaultCanvasWorkOrderLayout();
    let history = createHistory(a);
    const b = { ...a, gridMm: 5 as const };
    history = pushHistory(history, b);
    expect(history.present.gridMm).toBe(5);
    history = undoHistory(history);
    expect(history.present.gridMm).toBe(2);
    history = redoHistory(history);
    expect(history.present.gridMm).toBe(5);
  });
});
