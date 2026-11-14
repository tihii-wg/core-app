import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { defaultWorkOrderLayout } from "./defaultLayouts";
import { defaultCanvasWorkOrderLayout } from "./canvas/defaultCanvasLayouts";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { DEMO_PRINT_SOURCE_ID } from "./demoPrintContext";

const buildOrderPrintContext = vi.hoisted(() =>
  vi.fn(async (_orderId?: string, _workspaceId?: string | undefined, _documentType?: string) => ({
    order: { orderNumber: "REAL-1", clientName: "Real Client", services: [], materials: [] },
    invoice: null,
    invoiceSections: null,
    client: { name: "Real Client", phone: "1", email: "a@b.c", address: "X", tax_id: "1", client_type: "individual" },
    vehicle: null,
    workspace: null,
    legalEntity: null,
    logoUrl: null,
    companyPhone: "+373 22 000 000",
    currency: "MDL",
    dateFormat: "DD.MM.YYYY",
    timeZone: "UTC",
    locale: "en",
    paymentBalance: null,
    warrantyRecords: [],
    printedAt: new Date("2026-11-07T12:00:00.000Z"),
    documentKind: "work_order" as const,
    workspaceVatRate: 20,
    invoiceTaxTotal: null,
  })),
);

const printHtmlDocument = vi.hoisted(() => vi.fn());

vi.mock("../../services/printContext", () => ({
  buildOrderPrintContext: (orderId: string, workspaceId: string | undefined, documentType?: string) =>
    buildOrderPrintContext(orderId, workspaceId, documentType),
  buildInvoicePrintContext: vi.fn(),
  listRecentOrdersForPrintPreview: async () => [{ id: "o1", orderNumber: "ORD-REAL", clientName: "Ada" }],
  listRecentInvoicesForPrintPreview: async () => [],
}));

vi.mock("../../services/apiDocumentTemplates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiDocumentTemplates")>();
  return {
    ...actual,
    printHtmlDocument: (...args: unknown[]) => printHtmlDocument(...args),
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

function templateFixture(partial: Partial<DocumentTemplate> = {}): DocumentTemplate {
  return {
    id: "t1",
    workspaceId: "ws-1",
    name: "Work order",
    documentType: "work_order",
    widthMm: null,
    heightMm: null,
    showCents: true,
    isAvailableToAll: true,
    isActive: true,
    isDefault: true,
    layout: defaultWorkOrderLayout(),
    style: null,
    bodyHtml: "",
    ...partial,
  };
}

describe("TemplatePreviewDialog", () => {
  beforeEach(() => {
    buildOrderPrintContext.mockClear();
    printHtmlDocument.mockClear();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("renders block templates with demo data by default without loading a real order", async () => {
    renderWithQuery(
      <TemplatePreviewDialog
        open
        onOpenChange={() => undefined}
        template={templateFixture()}
        locale="en"
        currency="MDL"
        vatRate={20}
      />,
    );

    expect(screen.getByText("Sample (demo data)")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle(/Preview of Work order/i)).toBeInTheDocument();
    });
    expect(buildOrderPrintContext).not.toHaveBeenCalled();
  });

  it("renders legacy and canvas templates with demo data", async () => {
    const { rerender } = renderWithQuery(
      <TemplatePreviewDialog
        open
        onOpenChange={() => undefined}
        template={templateFixture({
          id: "legacy",
          layout: null,
          bodyHtml: "<p>#КЛИЕНТ-ИМЯ / #ИТОГО</p>",
        })}
        locale="en"
        currency="MDL"
      />,
    );
    await waitFor(() => expect(screen.getByTitle(/Preview of Work order/i)).toBeInTheDocument());

    rerender(
      <TemplatePreviewDialog
        open
        onOpenChange={() => undefined}
        template={templateFixture({
          id: "canvas",
          layout: defaultCanvasWorkOrderLayout(),
        })}
        locale="en"
        currency="MDL"
      />,
    );
    await waitFor(() => expect(screen.getByTitle(/Preview of Work order/i)).toBeInTheDocument());
    expect(buildOrderPrintContext).not.toHaveBeenCalled();
  });

  it("loads a real order context when the source switches away from demo", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <TemplatePreviewDialog
        open
        onOpenChange={() => undefined}
        template={templateFixture()}
        locale="en"
        currency="MDL"
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /ORD-REAL/i }));
    await waitFor(() => expect(buildOrderPrintContext).toHaveBeenCalledWith("o1", "ws-1", "work_order"));
  });

  it("prints the same HTML currently shown", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <TemplatePreviewDialog
        open
        onOpenChange={() => undefined}
        template={templateFixture({
          layout: null,
          bodyHtml: "<p>#ЗАКАЗ-НОМЕР</p>",
        })}
        locale="en"
        currency="MDL"
      />,
    );

    const printButton = await screen.findByRole("button", { name: "Print" });
    await waitFor(() => expect(printButton).not.toBeDisabled());
    await user.click(printButton);
    expect(printHtmlDocument).toHaveBeenCalledTimes(1);
    const html = printHtmlDocument.mock.calls[0]?.[0] as string;
    expect(html).toContain("ORD-2026-0001");
    expect(sourceStillDemo()).toBe(true);
  });

  it("applies fit-width zoom when the preview container is narrower than the page", async () => {
    const OriginalRO = globalThis.ResizeObserver;
    class MockRO {
      private readonly cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        Object.defineProperty(target, "clientWidth", { configurable: true, value: 343 });
        this.cb([{ target, contentRect: { width: 343 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MockRO as unknown as typeof ResizeObserver;

    try {
      renderWithQuery(
        <TemplatePreviewDialog
          open
          onOpenChange={() => undefined}
          template={templateFixture({ widthMm: 210 })}
          locale="en"
          currency="MDL"
        />,
      );

      await waitFor(() => expect(screen.getByTitle(/Preview of Work order/i)).toBeInTheDocument());
      await waitFor(() => {
        // 343px viewport − 26px sheet padding = 317px → 317 / 793.7 ≈ 39% (the sheet must fit inside the padding).
        expect(screen.getByTestId("preview-zoom").textContent).toBe("39%");
      });
      expect(screen.getByRole("button", { name: /Fit width|Pe lățime|По ширине/i })).toBeInTheDocument();
    } finally {
      globalThis.ResizeObserver = OriginalRO;
    }
  });
});

function sourceStillDemo() {
  return DEMO_PRINT_SOURCE_ID === "__demo__";
}
