import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Employee, Order } from "../../lib/types";
import OrderDetailPanel from "./OrderDetailPanel";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("./useUpdateOrder", () => ({
  useUpdateOrder: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({
    services: [{ id: "svc-tires", service_name: "Tires", service_price: 80, status: "active" }],
  }),
}));

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  orderNumber: "ORD-2026-003",
  device: "BMW",
  vin: "1HGBH41JXMN109186",
  carNumber: "ABC123",
  service: "Oil change",
  services: [],
  description: "Noise",
  status: "new",
  assignedEmployeeId: "emp-1",
  assignedEmployeeName: "Ada Tech",
  deadline: "2026-10-01",
  totalPrice: 40,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
};

const employees: Employee[] = [
  {
    id: "emp-1",
    name: "Ada Tech",
    email: "ada@example.com",
    phone: "+37361111111",
    role: "technician",
    status: "active",
    assignedTasks: 0,
    completedTasks: 0,
  },
];

function renderPanel(onOrderUpdated = vi.fn(), setDetailPanelOpen = vi.fn()) {
  renderWithQuery(
    <OrderDetailPanel
      selectedOrder={order}
      detailPanelOpen
      setDetailPanelOpen={setDetailPanelOpen}
      employees={employees}
      onOrderUpdated={onOrderUpdated}
      onStatusChange={vi.fn()}
    />,
  );

  return { setDetailPanelOpen };
}

describe("OrderDetailPanel", () => {
  it("opens with a description and a pencil button", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderPanel();

    expect(await screen.findByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
    expect(screen.getByText("View and edit this order's VIN, services, device, assignment, and deadline.")).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toHaveTextContent("");
    expect(editButton.querySelector("svg")).toBeInTheDocument();

    const descriptionWarnings = warn.mock.calls.filter((args) => String(args[0]).includes("Description"));
    expect(descriptionWarnings).toHaveLength(0);

    warn.mockRestore();
  });

  it("saves order edits and closes the details window", async () => {
    const user = userEvent.setup();
    const onOrderUpdated = vi.fn();
    const setDetailPanelOpen = vi.fn();
    mutateAsync.mockResolvedValue({ ...order, device: "Audi" });

    renderPanel(onOrderUpdated, setDetailPanelOpen);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const deviceInput = screen.getByLabelText("Device *");
    await user.clear(deviceInput);
    await user.type(deviceInput, "Audi");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        device: "Audi",
        carNumber: "ABC123",
        description: "Noise",
        assignedEmployeeId: "emp-1",
        vin: "1HGBH41JXMN109186",
      }),
    );
    expect(onOrderUpdated).toHaveBeenCalledWith(expect.objectContaining({ device: "Audi" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("saves an edited VIN and an added service", async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ ...order, vin: "2HGBH41JXMN109187" });

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const vinInput = screen.getByLabelText("VIN *");
    await user.clear(vinInput);
    await user.type(vinInput, "2HGBH41JXMN109187");
    await user.click(screen.getByPlaceholderText("Service"));
    await user.click(screen.getByRole("button", { name: "Tires" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        vin: "2HGBH41JXMN109187",
        services: [expect.objectContaining({ serviceId: "svc-tires", serviceName: "Tires", price: 80 })],
      }),
    );
  });
});
