import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderMaterial, Service } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import AddOrderServiceDialog from "./AddOrderServiceDialog";
import AddOrderMaterialDialog from "./AddOrderMaterialDialog";
import addNewOrderFormSource from "./AddNewOrderForm.tsx?raw";
import editOrderFormSource from "./EditOrderForm.tsx?raw";
import serviceDialogSource from "./AddOrderServiceDialog.tsx?raw";
import materialDialogSource from "./AddOrderMaterialDialog.tsx?raw";

const appendMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ slug: "auto_repair", services: [] as Service[] }));

vi.mock("./useAppendOrderLines", () => ({
  useAppendOrderLines: () => ({ mutateAsync: appendMock, isPending: false }),
}));
vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: state.services }),
}));
vi.mock("../inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({ items: [] }),
}));
vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({
    employees: [{ id: "emp-1", name: "Ada Tech", status: "active", role: "technician", profile_id: null }],
    error: null,
    isLoading: false,
  }),
}));
vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL", warrantyServiceMonths: 3 } }),
}));
vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (v: number) => `MDL ${v}`, currency: "MDL" }),
}));
vi.mock("../workspaces/useActiveWorkspaceRole", () => ({ useActiveWorkspaceRole: () => "owner" }));
vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));
vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(state.slug);
      return { workflow, copy: industryOrderCopy(workflow), profile: null, industrySlug: state.slug };
    },
  };
});
// The real editor is covered by its own tests; here it only has to receive the draft-only form wiring.
vi.mock("./OrderMaterialLinesEditor", () => ({
  default: ({
    fields,
    append,
    initialAddMode,
    initialFreeName,
    initialCatalogItem,
  }: {
    fields: Array<{ id: string; itemName: string }>;
    append: (line: OrderMaterial) => void;
    initialAddMode?: string;
    initialFreeName?: string;
    initialCatalogItem?: { id: string; name: string } | null;
  }) => (
    <div
      data-testid="material-editor-stub"
      data-initial-mode={initialAddMode ?? "catalog"}
      data-initial-free-name={initialFreeName ?? ""}
      data-initial-catalog-id={initialCatalogItem?.id ?? ""}
    >
      <button
        type="button"
        onClick={() =>
          append({ inventoryItemId: "item-1", itemName: "Brake pads", price: 99, quantity: 2, supplySource: "catalog", warehouseId: "wh-1" })
        }
      >
        stub add material
      </button>
      <ul>
        {fields.map((field) => (
          <li key={field.id}>{field.itemName}</li>
        ))}
      </ul>
    </div>
  ),
}));

const order = {
  id: "order-1",
  clientId: "client-1",
  assignedEmployeeId: "emp-1",
  team: [],
  services: [],
  materials: [],
} as unknown as Order;

const tires = { id: "svc-tires", service_name: "Tires", service_price: 80, status: "active" } as unknown as Service;

beforeEach(() => {
  appendMock.mockReset();
  appendMock.mockResolvedValue({ ...order, id: "order-1", updated: true });
  state.slug = "auto_repair";
  state.services = [tires];
});

async function pickService(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByPlaceholderText("Service"));
  await user.click(await screen.findByRole("button", { name: /Tires/ }));
}

describe("AddOrderServiceDialog", () => {
  it("renders nothing while closed", () => {
    renderWithQuery(<AddOrderServiceDialog open={false} onOpenChange={vi.fn()} order={order} onAdded={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires at least one line before saving", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddOrderServiceDialog open onOpenChange={vi.fn()} order={order} onAdded={vi.fn()} />);

    await user.click(await screen.findByTestId("add-order-lines-submit"));

    expect(await screen.findByText("Add at least one service")).toBeInTheDocument();
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("saves the draft lines (quantity, price, performer) through the append hook and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onAdded = vi.fn();
    renderWithQuery(<AddOrderServiceDialog open onOpenChange={onOpenChange} order={order} onAdded={onAdded} />);

    expect(await screen.findByRole("heading", { name: "Add service" })).toBeInTheDocument();
    await pickService(user);

    const quantity = await screen.findByLabelText("Quantity for Tires");
    await user.clear(quantity);
    await user.type(quantity, "2,5");

    await user.click(screen.getByTestId("add-order-lines-submit"));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    const input = appendMock.mock.calls[0][0];
    expect(input.orderId).toBe("order-1");
    expect(input.kind).toBe("services");
    expect(input.drafts).toHaveLength(1);
    expect(input.drafts[0]).toMatchObject({ serviceId: "svc-tires", serviceName: "Tires", price: 80, quantity: 2.5 });
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ updated: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and shows the error when the save fails (e.g. closed order)", async () => {
    appendMock.mockRejectedValue(new Error("Closed orders cannot be edited"));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onAdded = vi.fn();
    renderWithQuery(<AddOrderServiceDialog open onOpenChange={onOpenChange} order={order} onAdded={onAdded} />);

    await pickService(user);
    await user.click(await screen.findByTestId("add-order-lines-submit"));

    expect(await screen.findByTestId("add-order-lines-error")).toHaveTextContent("Closed orders cannot be edited");
    expect(onAdded).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("lets the user add several services before saving", async () => {
    state.services = [tires, { id: "svc-oil", service_name: "Oil", service_price: 40, status: "active" } as unknown as Service];
    const user = userEvent.setup();
    renderWithQuery(<AddOrderServiceDialog open onOpenChange={vi.fn()} order={order} onAdded={vi.fn()} />);

    await pickService(user);
    await user.click(screen.getByPlaceholderText("Service"));
    await user.click(await screen.findByRole("button", { name: /Oil/ }));
    await user.click(screen.getByTestId("add-order-lines-submit"));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    expect(appendMock.mock.calls[0][0].drafts.map((line: { serviceName: string }) => line.serviceName)).toEqual(["Tires", "Oil"]);
  });

  it("uses work wording for works-and-materials industries", async () => {
    state.slug = "home_services";
    renderWithQuery(<AddOrderServiceDialog open onOpenChange={vi.fn()} order={order} onAdded={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Add work" })).toBeInTheDocument();
  });
});

describe("AddOrderMaterialDialog", () => {
  it("appends the drafts built by the shared material editor", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(<AddOrderMaterialDialog open onOpenChange={onOpenChange} order={order} onAdded={onAdded} />);

    expect(await screen.findByRole("heading", { name: "Add product" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "stub add material" }));
    expect(within(screen.getByTestId("material-editor-stub")).getByText("Brake pads")).toBeInTheDocument();
    await user.click(screen.getByTestId("add-order-lines-submit"));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      orderId: "order-1",
      kind: "materials",
      drafts: [expect.objectContaining({ inventoryItemId: "item-1", quantity: 2, warehouseId: "wh-1" })],
    });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open with the stock error when the warehouse issue fails", async () => {
    appendMock.mockRejectedValue(new Error("Insufficient stock for Brake pads"));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithQuery(<AddOrderMaterialDialog open onOpenChange={onOpenChange} order={order} onAdded={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "stub add material" }));
    await user.click(screen.getByTestId("add-order-lines-submit"));

    expect(await screen.findByTestId("add-order-lines-error")).toHaveTextContent("Insufficient stock for Brake pads");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("requires at least one material", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddOrderMaterialDialog open onOpenChange={vi.fn()} order={order} onAdded={vi.fn()} />);
    await user.click(await screen.findByTestId("add-order-lines-submit"));
    expect(await screen.findByText("Add at least one material")).toBeInTheDocument();
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("accepts catalog prefill from the items-tab search", async () => {
    renderWithQuery(
      <AddOrderMaterialDialog
        open
        onOpenChange={vi.fn()}
        order={order}
        onAdded={vi.fn()}
        prefill={{ kind: "catalog", item: { id: "item-filter", name: "Oil filter", sellingPrice: 12 } as never }}
      />,
    );
    expect(await screen.findByTestId("material-editor-stub")).toHaveAttribute("data-initial-catalog-id", "item-filter");
  });

  it("accepts freeform prefill from the items-tab search", async () => {
    renderWithQuery(
      <AddOrderMaterialDialog
        open
        onOpenChange={vi.fn()}
        order={order}
        onAdded={vi.fn()}
        prefill={{ kind: "one_time", name: "Custom gasket" }}
      />,
    );
    const editor = await screen.findByTestId("material-editor-stub");
    expect(editor).toHaveAttribute("data-initial-mode", "one_time");
    expect(editor).toHaveAttribute("data-initial-free-name", "Custom gasket");
  });
});

describe("shared line components", () => {
  it("is the one services UI used by AddNewOrderForm, EditOrderForm and AddOrderServiceDialog", () => {
    for (const source of [addNewOrderFormSource, editOrderFormSource, serviceDialogSource]) {
      expect(source).toContain('from "./OrderServiceLinesFields"');
      expect(source).toContain("<OrderServiceLinesFields");
      // No second copy of the per-line price / warranty / performer controls.
      expect(source).not.toContain("<OrderLinePriceField");
      expect(source).not.toContain("<OrderLineWarrantyFields");
      expect(source).not.toContain("<ServiceCombobox");
    }
  });

  it("is the one materials UI used by AddNewOrderForm, EditOrderForm and AddOrderMaterialDialog", () => {
    for (const source of [addNewOrderFormSource, editOrderFormSource, materialDialogSource]) {
      expect(source).toContain('from "./OrderMaterialLinesEditor"');
      expect(source).toContain("<OrderMaterialLinesEditor");
    }
  });
});
