import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkOrderLayout } from "./defaultLayouts";
import { emptyPrintContext } from "./templateVariables";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/supabase", () => ({
  default: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("../../services/printContext", () => ({
  buildOrderPrintContext: vi.fn(async () =>
    emptyPrintContext({
      order: {
        id: "o1",
        clientId: "c1",
        clientName: "Ada",
        orderNumber: "ORD-1",
        device: "",
        vin: "",
        carNumber: "",
        service: "",
        services: [],
        materials: [],
        description: "",
        status: "new",
        assignedEmployeeId: "",
        assignedEmployeeName: "",
        deadline: "",
        totalPrice: 0,
        isPaid: false,
        paymentStatus: "unpaid",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  ),
  buildInvoicePrintContext: vi.fn(),
}));

vi.mock("../../i18n", () => ({
  default: { t: (key: string) => key },
}));

import {
  renderTemplateDocument,
  setDefaultDocumentTemplate,
  toDocumentTemplate,
} from "../../services/apiDocumentTemplates";

describe("renderTemplateDocument", () => {
  it("prefers layout over body_html", () => {
    const template = toDocumentTemplate({
      id: "t1",
      workspace_id: "ws",
      name: "WO",
      document_type: "work_order",
      body_html: "<p>LEGACY_ONLY</p>",
      layout: defaultWorkOrderLayout(),
      is_default: true,
      show_cents: true,
      is_available_to_all: true,
      is_active: true,
    });
    const html = renderTemplateDocument(template, emptyPrintContext());
    expect(html).toContain("Заказ-наряд");
    expect(html).not.toContain("LEGACY_ONLY");
  });

  it("falls back to legacy body_html when layout is null", () => {
    const template = toDocumentTemplate({
      id: "t1",
      workspace_id: "ws",
      name: "Legacy",
      document_type: "order",
      body_html: "<p>LEGACY_ONLY</p>",
      layout: null,
      is_default: false,
      show_cents: true,
      is_available_to_all: true,
      is_active: true,
    });
    const html = renderTemplateDocument(template, emptyPrintContext());
    expect(html).toContain("LEGACY_ONLY");
  });
});

describe("setDefaultDocumentTemplate", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("unsets previous defaults then sets the new one", async () => {
    const updates: Array<{ is_default?: boolean; id?: string }> = [];
    fromMock.mockImplementation(() => {
      const api = {
        select: () => api,
        eq: () => api,
        is: () => api,
        order: () => api,
        update: (payload: { is_default?: boolean }) => {
          updates.push(payload);
          return {
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: async () => ({ data: [{ id: "t-new" }], error: null }),
                }),
              }),
            }),
          };
        },
      };
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "t-old",
                      workspace_id: "ws",
                      name: "Old",
                      document_type: "work_order",
                      body_html: "",
                      layout: defaultWorkOrderLayout(),
                      is_default: true,
                      show_cents: true,
                      is_available_to_all: true,
                      is_active: true,
                    },
                    {
                      id: "t-new",
                      workspace_id: "ws",
                      name: "New",
                      document_type: "work_order",
                      body_html: "",
                      layout: defaultWorkOrderLayout(),
                      is_default: false,
                      show_cents: true,
                      is_available_to_all: true,
                      is_active: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: api.update,
      };
    });

    await setDefaultDocumentTemplate("t-new", "ws");
    expect(updates.some((row) => row.is_default === false)).toBe(true);
    expect(updates.some((row) => row.is_default === true)).toBe(true);
  });
});
