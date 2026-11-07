import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { defaultWorkOrderLayout } from "../documents/defaultLayouts";
import { moveItemInList } from "../documents/DocumentTemplateBuilder";
import { insertTextAtCursor, PrintTemplatesSettings } from "./PrintTemplatesSettings";

const saveMutate = vi.hoisted(() => vi.fn());
const setDefaultMutate = vi.hoisted(() => vi.fn());
const createMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());
const buildOrderPrintContext = vi.hoisted(() => vi.fn());

const template = {
  id: "t1",
  workspaceId: "ws-1",
  name: "Work order",
  documentType: "work_order",
  widthMm: null,
  heightMm: null,
  showCents: true,
  isAvailableToAll: true,
  isActive: true,
  isDefault: false,
  layout: defaultWorkOrderLayout(),
  style: null,
  bodyHtml: "<p>legacy</p>",
};

vi.mock("../documents/useGetDocumentTemplates", () => ({
  useGetDocumentTemplates: () => ({
    data: [template],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../documents/useDocumentTemplateMutations", () => ({
  useCreateDocumentTemplate: () => ({ mutate: createMutate, isPending: false }),
  useDuplicateDocumentTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameDocumentTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteDocumentTemplate: () => ({ mutate: deleteMutate, isPending: false }),
  useSetDefaultDocumentTemplate: () => ({ mutate: setDefaultMutate, isPending: false }),
  useSaveDocumentTemplateLayout: () => ({ mutate: saveMutate, isPending: false }),
}));

vi.mock("../documents/useUpdateDocumentTemplate", () => ({
  useUpdateDocumentTemplateBody: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useCanEditWorkspaceSettings: () => true,
  useGuardSubscriptionWrite: () => () => undefined,
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../../services/printContext", () => ({
  buildOrderPrintContext: (...args: unknown[]) => buildOrderPrintContext(...args),
  buildInvoicePrintContext: vi.fn(),
  listRecentOrdersForPrintPreview: async () => [{ id: "o1", orderNumber: "ORD-1", clientName: "Ada" }],
  listRecentInvoicesForPrintPreview: async () => [],
}));

const ensureDefaultInvoiceTemplate = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null));
const ensureDefaultDocumentStyle = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null));
const ensureIndustryDocumentTemplates = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 0));

vi.mock("../../services/apiDocumentTemplates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiDocumentTemplates")>();
  return {
    ...actual,
    ensureDefaultInvoiceTemplate: (...args: unknown[]) => ensureDefaultInvoiceTemplate(...args),
    ensureDefaultDocumentStyle: (...args: unknown[]) => ensureDefaultDocumentStyle(...args),
  };
});

vi.mock("../industries/seedIndustryDefaults", () => ({
  ensureIndustryDocumentTemplates: (...args: unknown[]) => ensureIndustryDocumentTemplates(...args),
}));

vi.mock("../industries/useIndustryProfile", async () => {
  const { industryProfile } = await import("../industries/industryProfile");
  const profile = industryProfile("furniture_manufacturing");
  return {
    useIndustryProfile: () => ({
      profile,
      industrySlug: "furniture_manufacturing",
      industryId: null,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { documentLanguage: "en", language: "en", currency: "MDL", name: "Demo" } }),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe("insertTextAtCursor", () => {
  it("inserts a token at the caret", () => {
    expect(insertTextAtCursor({ value: "Hello !", selectionStart: 6, selectionEnd: 6 }, "#ЗАКАЗ-НОМЕР")).toEqual({
      next: "Hello #ЗАКАЗ-НОМЕР!",
      caret: 6 + "#ЗАКАЗ-НОМЕР".length,
    });
  });
});

describe("moveItemInList", () => {
  it("reorders with up/down indices", () => {
    expect(moveItemInList(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

describe("PrintTemplatesSettings builder", () => {
  beforeEach(() => {
    saveMutate.mockReset();
    setDefaultMutate.mockReset();
    createMutate.mockReset();
    deleteMutate.mockReset();
    buildOrderPrintContext.mockReset();
    ensureDefaultInvoiceTemplate.mockClear();
    ensureDefaultDocumentStyle.mockClear();
    ensureIndustryDocumentTemplates.mockClear();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
    buildOrderPrintContext.mockResolvedValue({
      order: {
        id: "o1",
        orderNumber: "ORD-1",
        clientName: "Ada",
        status: "new",
        services: [{ serviceId: "s1", serviceName: "Oil", price: 10, quantity: 1 }],
        materials: [],
        totalPrice: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      invoice: null,
      client: null,
      vehicle: null,
      workspace: null,
      legalEntity: null,
      logoUrl: null,
      companyPhone: null,
      currency: "MDL",
      dateFormat: "DD.MM.YYYY",
      timeZone: "Europe/Chisinau",
      locale: "en",
      paymentBalance: null,
      warrantyRecords: [],
      printedAt: new Date("2026-11-06T12:00:00.000Z"),
    });
  });

  it("does not call ensureIndustryDocumentTemplates on mount", async () => {
    renderWithQuery(<PrintTemplatesSettings />);
    await waitFor(() => expect(ensureDefaultDocumentStyle).toHaveBeenCalled());
    expect(ensureIndustryDocumentTemplates).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Add templates for my business type/i })).toBeInTheDocument();
  });

  it("opens the builder, toggles a column, and saves layout", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrintTemplatesSettings />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Blocks")).toBeInTheDocument();

    // Select the services table block (first table in default layout).
    const blockButtons = screen.getAllByRole("button", { name: /Table/i });
    await user.click(blockButtons[0]!);

    const skuSwitch = screen.getAllByRole("switch")[0];
    if (skuSwitch) await user.click(skuSwitch);

    const sumInputs = screen.getAllByDisplayValue("Sum");
    if (sumInputs[0]) {
      await user.clear(sumInputs[0]);
      await user.type(sumInputs[0], "Итого");
    }

    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    const payload = saveMutate.mock.calls[0]?.[0] as { layout: { blocks: unknown[] }; templateId: string };
    expect(payload.templateId).toBe("t1");
    expect(payload.layout.blocks.length).toBeGreaterThan(0);
  });

  it("sets a template as default", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrintTemplatesSettings />);
    await user.click(screen.getByRole("button", { name: "Set as default" }));
    expect(setDefaultMutate).toHaveBeenCalledWith("t1");
  });

  it("moves field blocks with keyboard-accessible up/down buttons", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrintTemplatesSettings />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
    const before = screen.getAllByRole("button", { name: /Client|Vehicle|Order|Company|Document|Table|Totals|Warranty|Signatures/i });
    expect(before.length).toBeGreaterThan(2);
    await user.click(moveDownButtons[0]!);
    // After move, unsaved banner appears.
    expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it("asks before deleting a template and deletes only after confirm", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrintTemplatesSettings />);

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Delete this print template/i)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    const confirmDialog = await screen.findByRole("dialog");
    await user.click(within(confirmDialog).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("t1"));
  });

  it("asks before discarding unsaved builder changes on cancel", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrintTemplatesSettings />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
    await user.click(moveDownButtons[0]!);
    expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument();

    const builderCancel = screen.getAllByRole("button", { name: "Cancel" }).at(-1)!;
    await user.click(builderCancel);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Leave without saving/i })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Blocks")).toBeInTheDocument();
  });
});
