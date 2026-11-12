import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order, OrderService } from "../../lib/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";

const mutateAsync = vi.hoisted(() => vi.fn());
const showKm = vi.hoisted(() => ({ value: true }));

vi.mock("./useUpdateOrderServiceLine", () => ({
  useUpdateOrderServiceLine: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    industrySlug: "auto_repair",
    workflow: { slug: "auto_repair" },
    copy: {},
    profile: null,
  }),
}));

vi.mock("../industries/industryCapabilities", () => ({
  industryUsesMileageWarranty: () => showKm.value,
  industrySupportsClientVehicles: () => showKm.value,
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({
    employees: [{ id: "emp-1", name: "Ada Tech", linkedUserId: "u1" }],
    error: null,
    isLoading: false,
  }),
}));

vi.mock("./useWorkspaceWarrantyDefaults", () => ({
  useWorkspaceWarrantyDefaults: () => ({ months: 6, days: null, km: null }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => `MDL ${n.toFixed(2)}` }),
}));

vi.mock("./useOrderServiceKindSupport", () => ({
  useOrderServiceKindSupport: () => true,
}));

import EditOrderServiceLineDialog from "./EditOrderServiceLineDialog";

const line: OrderService = {
  id: "line-1",
  serviceId: "svc-oil",
  serviceName: "Oil change",
  price: 40,
  quantity: 1,
  technicianId: "emp-1",
  technicianName: "Ada Tech",
  warrantyMonths: 6,
  warrantyDays: null,
  warrantyKm: 10000,
  kind: "service",
};

const order = {
  id: "order-1",
  orderNumber: "ORD-1",
  status: "in_progress",
  assignedEmployeeId: "emp-1",
  team: [{ employeeId: "emp-1", role: "lead", name: "Ada Tech" }],
  services: [line],
  materials: [],
  vehicleMileageUnitSnapshot: "km",
} as unknown as Order;

function renderDialog(overrides?: {
  order?: Order;
  line?: OrderService;
  open?: boolean;
}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <EditOrderServiceLineDialog
          open={overrides?.open ?? true}
          onOpenChange={onOpenChange}
          order={overrides?.order ?? order}
          line={overrides?.line ?? line}
          onSaved={onSaved}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

describe("EditOrderServiceLineDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    showKm.value = true;
    mutateAsync.mockResolvedValue({ ...order, services: [{ ...line, price: 55 }] });
  });

  it("shows only one line prefilled and hides add/remove controls", async () => {
    renderDialog();
    expect(await screen.findByTestId("edit-order-service-line-submit")).toBeInTheDocument();
    expect(screen.getAllByText("Oil change").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("add-order-lines-body").querySelector("[data-single-line='true']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/quantity/i)).toHaveValue("1");
  });

  it("disables Save while unchanged and sends only the patched fields", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    const submit = await screen.findByTestId("edit-order-service-line-submit");
    expect(submit).toBeDisabled();

    const price = screen.getByLabelText(/price/i);
    await user.clear(price);
    await user.type(price, "55");
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        orderId: "order-1",
        lineId: "line-1",
        patch: expect.objectContaining({ price: 55 }),
      });
    });
    expect(onSaved).toHaveBeenCalled();
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.quantity).toBeUndefined();
    expect(patch.warrantyMonths).toBeUndefined();
  });

  it("can clear warranty months in the patch", async () => {
    const user = userEvent.setup();
    renderDialog();
    const months = await screen.findByLabelText(/months/i);
    await user.clear(months);
    // blur to commit
    months.blur();
    await user.click(screen.getByTestId("edit-order-service-line-submit"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.warrantyMonths).toBeNull();
  });

  it("hides km when the industry has no mileage warranty", async () => {
    showKm.value = false;
    renderDialog({
      line: { ...line, warrantyKm: null },
      order: { ...order, services: [{ ...line, warrantyKm: null }] },
    });
    await screen.findByTestId("edit-order-service-line-submit");
    expect(screen.queryByLabelText(/mileage|км|km/i)).not.toBeInTheDocument();
  });

  it("does not mount when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("edit-order-service-line-submit")).not.toBeInTheDocument();
  });
});
