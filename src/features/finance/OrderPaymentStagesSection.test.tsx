import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { OrderPaymentStagesSection } from "./OrderPaymentStagesSection";

const stagesState = vi.hoisted(() => ({
  stages: [] as Array<{
    id: string;
    position: number;
    name: string;
    mode: "percent" | "amount" | "remainder";
    percent: number | null;
    amount: number | null;
    dueDate: string | null;
    invoiceId: string | null;
  }>,
}));

vi.mock("./useOrderPaymentStages", () => ({
  useOrderPaymentStages: () => ({ stages: stagesState.stages, isLoading: false }),
  useReplaceOrderPaymentStages: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLinkStageInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (v: number) => `${v}`, currency: "MDL" }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { paymentStageTemplate: null, industrySlug: "furniture_manufacturing" } }),
}));

vi.mock("../industries/useIndustryProfile", () => ({
  useIndustryProfile: () => ({
    profile: {
      paymentStageTemplate: [
        { nameKey: "a", mode: "percent", percent: 50, dueDays: 0 },
        { nameKey: "b", mode: "remainder" },
      ],
    },
  }),
}));

vi.mock("../industries/industryProfile", () => ({
  industryPaymentStageTemplate: () => [
    { name: "Pre", mode: "percent", percent: 50, dueDays: 0 },
    { name: "Rest", mode: "remainder" },
  ],
}));

vi.mock("../reports/reportFormatting", () => ({
  useReportFormatting: () => ({ formatDate: (v: string) => v }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../../services/apiInvoices", () => ({
  createInvoiceFromOrder: vi.fn(),
  getInvoices: vi.fn(async () => []),
}));

const order: Order = {
  id: "order-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  description: "",
  status: "closed",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  closedAt: "2026-01-01",
  createdAt: "",
  updatedAt: "",
};

describe("OrderPaymentStagesSection", () => {
  it("is read-only on closed orders (no edit actions)", () => {
    stagesState.stages = [
      {
        id: "s1",
        position: 0,
        name: "Pre",
        mode: "percent",
        percent: 50,
        amount: null,
        dueDate: null,
        invoiceId: null,
      },
      {
        id: "s2",
        position: 1,
        name: "Rest",
        mode: "remainder",
        percent: null,
        amount: null,
        dueDate: null,
        invoiceId: null,
      },
    ];
    renderWithQuery(<OrderPaymentStagesSection order={order} payments={[]} canEdit={false} />);
    expect(screen.getByTestId("order-payment-stages")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply template|Применить шаблон|Aplică șablonul/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add stage|Добавить этап|Adaugă etapă/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Pre").length).toBeGreaterThan(0);
  });

  it("offers template actions when editable and empty", () => {
    stagesState.stages = [];
    renderWithQuery(
      <OrderPaymentStagesSection order={{ ...order, status: "in-progress" }} payments={[]} canEdit />,
    );
    expect(screen.getByRole("button", { name: /Apply template|Применить шаблон|Aplică șablonul/i })).toBeInTheDocument();
  });
});
