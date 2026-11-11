import type { ComponentProps } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { InventoryItem, Order, Service } from "../../lib/types";
import OrderAddLinesSearch from "./OrderAddLinesSearch";

const appendMock = vi.hoisted(() => vi.fn());
const servicesState = vi.hoisted(() => ({ services: [] as Service[] }));
const inventoryState = vi.hoisted(() => ({ items: [] as InventoryItem[] }));
const roleState = vi.hoisted(() => ({ role: "owner" as string }));
const freeformState = vi.hoisted(() => ({ supported: true }));
const toastError = vi.hoisted(() => vi.fn());
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { error: toastError, success: vi.fn() }));

vi.mock("react-hot-toast", () => ({
  default: toastFn,
}));

vi.mock("./useAppendOrderLines", () => ({
  useAppendOrderLines: () => ({
    mutateAsync: appendMock,
    isPending: false,
  }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: servicesState.services }),
}));

vi.mock("../inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({ items: inventoryState.items }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => roleState.role,
}));

vi.mock("./useOrderMaterialFreeformSupport", () => ({
  useOrderMaterialFreeformSupport: () => ({ supported: freeformState.supported, ready: true }),
}));

vi.mock("./useWorkspaceWarrantyDefaults", () => ({
  useWorkspaceWarrantyDefaults: () => ({
    serviceDurationMonths: 6,
    serviceMileageLimit: null,
    partsDurationMonths: 3,
    partsMileageLimit: null,
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const order = {
  id: "order-1",
  services: [],
  materials: [],
  vehicleMileageUnitSnapshot: "km",
} as unknown as Order;

const oilService = {
  id: "svc-oil",
  service_name: "Oil change",
  category: "Maintenance",
  service_price: 40,
  status: "active",
  duration: 30,
  description: "",
  defaultTechnicianId: "tech-1",
} as Service;

const filterItem = {
  id: "item-filter",
  name: "Oil filter",
  sku: "OF-1",
  category: "Filters",
  supplier: "Bosch",
  quantity: 3,
  unit: "pcs",
  sellingPrice: 12,
  purchasePrice: 8,
  isActive: true,
} as InventoryItem;

function renderSearch(props: Partial<ComponentProps<typeof OrderAddLinesSearch>> = {}) {
  const onServiceAdded = props.onServiceAdded ?? vi.fn();
  const onHighlightServiceLine = props.onHighlightServiceLine ?? vi.fn();
  const onOpenMaterial = props.onOpenMaterial ?? vi.fn();
  renderWithQuery(
    <OrderAddLinesSearch
      order={props.order ?? order}
      industrySlug={props.industrySlug ?? "auto_repair"}
      allowServices={props.allowServices ?? true}
      allowMaterials={props.allowMaterials ?? true}
      onServiceAdded={onServiceAdded}
      onHighlightServiceLine={onHighlightServiceLine}
      onOpenMaterial={onOpenMaterial}
    />,
  );
  return { onServiceAdded, onHighlightServiceLine, onOpenMaterial };
}

describe("OrderAddLinesSearch", () => {
  beforeEach(() => {
    appendMock.mockReset();
    toastFn.mockReset();
    toastError.mockReset();
    roleState.role = "owner";
    freeformState.supported = true;
    servicesState.services = [oilService];
    inventoryState.items = [filterItem];
    appendMock.mockResolvedValue({ ...order, services: [{ serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 }] });
  });

  it("finds both a service and an item while typing", async () => {
    const user = userEvent.setup();
    renderSearch();

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "oil");

    const menu = await screen.findByTestId("order-add-lines-search-menu");
    expect(within(menu).getByTestId("order-add-lines-service-svc-oil")).toBeInTheDocument();
    expect(within(menu).getByTestId("order-add-lines-item-item-filter")).toBeInTheDocument();
  });

  it("selecting a service calls appendOrderServiceLines once with catalog defaults and does not open a dialog", async () => {
    const user = userEvent.setup();
    const { onServiceAdded, onOpenMaterial } = renderSearch();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTestId("order-add-lines-service-svc-oil"));

    await waitFor(() => {
      expect(appendMock).toHaveBeenCalledTimes(1);
    });
    expect(appendMock).toHaveBeenCalledWith({
      orderId: "order-1",
      kind: "services",
      drafts: [
        expect.objectContaining({
          serviceId: "svc-oil",
          serviceName: "Oil change",
          price: 40,
          quantity: 1,
          technicianId: "tech-1",
        }),
      ],
    });
    expect(onServiceAdded).toHaveBeenCalled();
    expect(onOpenMaterial).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selecting an item opens the material form prefilled", async () => {
    const user = userEvent.setup();
    const { onOpenMaterial } = renderSearch();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTestId("order-add-lines-item-item-filter"));

    expect(onOpenMaterial).toHaveBeenCalledWith({ kind: "catalog", item: filterItem });
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("does not add a duplicate catalog service", async () => {
    const user = userEvent.setup();
    const { onHighlightServiceLine, onServiceAdded } = renderSearch({
      order: {
        ...order,
        services: [{ serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 }],
      } as Order,
    });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTestId("order-add-lines-service-svc-oil"));

    expect(appendMock).not.toHaveBeenCalled();
    expect(onServiceAdded).not.toHaveBeenCalled();
    expect(onHighlightServiceLine).toHaveBeenCalledWith("svc-oil");
    expect(toastFn).toHaveBeenCalled();
  });

  it("shows no-match actions with the right permissions", async () => {
    const user = userEvent.setup();
    servicesState.services = [];
    inventoryState.items = [];
    renderSearch();

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "UniqueWidget");

    expect(await screen.findByTestId("order-add-lines-create-service")).toBeInTheDocument();
    expect(screen.getByTestId("order-add-lines-one-time")).toBeInTheDocument();
    expect(screen.getByTestId("order-add-lines-customer")).toBeInTheDocument();
  });

  it("hides create-service for roles that cannot manage services", async () => {
    const user = userEvent.setup();
    roleState.role = "member";
    servicesState.services = [];
    inventoryState.items = [];
    renderSearch({ allowMaterials: false });

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "UniqueWidget");

    expect(await screen.findByTestId("order-add-lines-search-menu")).toHaveTextContent(/Nothing found/i);
    expect(screen.queryByTestId("order-add-lines-create-service")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-add-lines-one-time")).not.toBeInTheDocument();
  });
});
