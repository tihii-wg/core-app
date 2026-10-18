import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Service } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { Services } from "./Services";

const serviceHooks = vi.hoisted(() => ({
  services: [] as Service[],
  isLoading: false,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("./useGetServices", () => ({
  default: () => ({
    services: serviceHooks.services,
    isLoading: serviceHooks.isLoading,
    isPending: serviceHooks.isPending,
    error: serviceHooks.error,
    refetch: serviceHooks.refetch,
  }),
}));

vi.mock("./useDeleteService", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./useUpdateService", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${Number(value).toFixed(2)}`,
  }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        shell: {},
        industrySlug: "auto_repair",
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

vi.mock("./AddNewServiceForm", () => ({
  default: () => <div>Create service form</div>,
}));

function service(partial: Partial<Service> = {}): Service {
  return {
    id: "svc-1",
    service_name: "Oil change",
    category: "repair",
    duration: 30,
    service_price: 40,
    description: "Standard oil change",
    status: "active",
    ...partial,
  };
}

describe("Services", () => {
  it("opens the edit dialog when a service row is clicked without looping updates", async () => {
    const user = userEvent.setup();
    serviceHooks.services = [service()];
    serviceHooks.isLoading = false;
    serviceHooks.isPending = false;
    serviceHooks.error = null;

    renderWithQuery(<Services />);

    expect(screen.getByText("Oil change")).toBeInTheDocument();
    await user.click(screen.getByText("Oil change"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Service" })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Oil change")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("40")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("opens the same edit dialog from the edit affordance", async () => {
    const user = userEvent.setup();
    serviceHooks.services = [service({ service_name: "Brake check", service_price: 25 })];

    renderWithQuery(<Services />);

    await user.click(screen.getByRole("button", { name: "Edit Brake check" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Service" })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Brake check")).toBeInTheDocument();
  });
});
