import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const getTemplatesState = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("../../services/supabase", () => ({
  default: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string) => (key === "settings.printTemplates.standardInvoice" ? "Standard invoice" : key),
    getFixedT: () => (key: string) => key,
  },
  currentLanguage: () => "en",
}));

vi.mock("../../i18n/languages", () => ({
  isAppLanguage: (value: string | null | undefined) => value === "en" || value === "ro" || value === "ru",
}));

import { ensureDefaultInvoiceTemplate } from "../../services/apiDocumentTemplates";
import { defaultInvoiceLayout } from "./defaultLayouts";

describe("ensureDefaultInvoiceTemplate", () => {
  beforeEach(() => {
    fromMock.mockReset();
    getTemplatesState.rows = [];
  });

  it("creates a default Standard invoice when none exist", async () => {
    fromMock.mockImplementation(() => {
      const listApi = {
        select: () => listApi,
        eq: () => listApi,
        is: () => listApi,
        order: () => ({
          order: async () => ({ data: getTemplatesState.rows, error: null }),
        }),
      };
      return {
        select: () => listApi,
        insert: (payload: Record<string, unknown>) => {
          expect(payload.document_type).toBe("invoice");
          expect(payload.is_default).toBe(true);
          expect(payload.name).toBe("Standard invoice");
          const row = {
            id: "inv-default",
            workspace_id: "ws",
            name: payload.name,
            document_type: "invoice",
            body_html: payload.body_html,
            layout: defaultInvoiceLayout(),
            is_default: true,
            show_cents: true,
            is_available_to_all: true,
            is_active: true,
          };
          getTemplatesState.rows = [row];
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
      };
    });

    const created = await ensureDefaultInvoiceTemplate("ws");
    expect(created?.id).toBe("inv-default");
    expect(created?.isDefault).toBe(true);
    expect(created?.documentType).toBe("invoice");
  });

  it("returns existing invoice template without inserting", async () => {
    getTemplatesState.rows = [
      {
        id: "existing",
        workspace_id: "ws",
        name: "Mine",
        document_type: "invoice",
        body_html: "<p>x</p>",
        layout: defaultInvoiceLayout(),
        is_default: true,
        show_cents: true,
        is_available_to_all: true,
        is_active: true,
      },
    ];
    let inserted = false;
    fromMock.mockImplementation(() => {
      const listApi = {
        select: () => listApi,
        eq: () => listApi,
        is: () => listApi,
        order: () => ({
          order: async () => ({ data: getTemplatesState.rows, error: null }),
        }),
      };
      return {
        select: () => listApi,
        insert: () => {
          inserted = true;
          return { select: () => ({ single: async () => ({ data: null, error: { message: "no" } }) }) };
        },
      };
    });

    const found = await ensureDefaultInvoiceTemplate("ws");
    expect(found?.id).toBe("existing");
    expect(inserted).toBe(false);
  });
});
