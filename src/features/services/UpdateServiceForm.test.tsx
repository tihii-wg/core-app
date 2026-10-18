import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Service } from "../../lib/types";
import UpdateServiceForm from "./UpdateServiceForm";

vi.mock("./useUpdateService", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
      // Intentionally allocate a fresh workflow object each render (matches production).
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

const service: Service = {
  id: "svc-1",
  service_name: "Oil change",
  category: "repair",
  duration: 30,
  service_price: 40,
  description: "",
  status: "active",
};

describe("UpdateServiceForm", () => {
  it("renders stably when industryWorkflow returns a new object each render", () => {
    const setEditModalOpen = vi.fn();
    render(<UpdateServiceForm service={service} setEditModalOpen={setEditModalOpen} />);

    expect(screen.getByDisplayValue("Oil change")).toBeInTheDocument();
    expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    expect(setEditModalOpen).not.toHaveBeenCalled();
  });
});
