import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../lib/appContext";
import type { NavCounts } from "../features/nav/useNavCounts";
import { AppSidebar } from "./AppSidebar";

const navCounts = vi.hoisted(() => ({
  counts: {} as NavCounts,
  isLoading: false,
  hasError: false,
}));

const navigate = vi.hoisted(() => vi.fn());

vi.mock("../features/nav/useNavCounts", () => ({
  useNavCounts: () => navCounts,
}));

vi.mock("../features/industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy, industryShellCopy } = await import("../features/industries/industryWorkflow");
  const workflow = industryWorkflow("auto_repair");
  return {
    useIndustryWorkflow: () => ({
      workflow,
      copy: industryOrderCopy(workflow),
      shell: industryShellCopy(workflow),
      industrySlug: "auto_repair",
      industryId: null,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

function renderSidebar(path = "/en/ws-1/orders") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AppProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/:lang/:workspaceId/:module" element={children as ReactElement} />
            </Routes>
          </MemoryRouter>
        </AppProvider>
      </QueryClientProvider>
    );
  }

  return render(<AppSidebar />, { wrapper: Wrapper });
}

describe("AppSidebar nav counts", () => {
  beforeEach(() => {
    navigate.mockReset();
    navCounts.counts = {
      orders: 12,
      clients: 8,
      services: 4,
      inventory: 20,
      employees: 3,
    };
    navCounts.isLoading = false;
    navCounts.hasError = false;
  });

  it("shows live counts for orders, clients, services, inventory, and employees", () => {
    renderSidebar();

    expect(screen.getByTestId("nav-count-orders")).toHaveTextContent("12");
    expect(screen.getByTestId("nav-count-clients")).toHaveTextContent("8");
    expect(screen.getByTestId("nav-count-services")).toHaveTextContent("4");
    expect(screen.getByTestId("nav-count-inventory")).toHaveTextContent("20");
    expect(screen.getByTestId("nav-count-employees")).toHaveTextContent("3");
    expect(screen.queryByTestId("nav-count-dashboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-count-settings")).not.toBeInTheDocument();
  });

  it("includes the count in the accessible name without breaking navigation", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const orders = screen.getByRole("button", { name: /Orders,\s*12/i });
    await user.click(orders);

    expect(navigate).toHaveBeenCalledWith("/en/ws-1/orders");
  });

  it("hides badges while counts are loading instead of showing zero", () => {
    navCounts.counts = {};
    navCounts.isLoading = true;
    renderSidebar();

    expect(screen.queryByTestId("nav-count-orders")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Orders$/i })).toBeInTheDocument();
  });

  it("keeps navigation usable when counts fail", async () => {
    const user = userEvent.setup();
    navCounts.counts = { orders: 5 };
    navCounts.hasError = true;
    renderSidebar();

    expect(screen.getByTestId("nav-count-orders")).toHaveTextContent("5");
    expect(screen.queryByTestId("nav-count-clients")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Clients$/i }));
    expect(navigate).toHaveBeenCalledWith("/en/ws-1/clients");
  });

  it("hides count badges in the collapsed rail so icons stay clear", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: /Collapse sidebar/i }));

    expect(screen.queryByTestId("nav-count-orders")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Orders,\s*12/i })).toBeInTheDocument();
  });

  it("compacts large totals without overflowing the nav row", () => {
    navCounts.counts = {
      orders: 12500,
      clients: 8,
      services: 4,
      inventory: 20,
      employees: 3,
    };
    renderSidebar();

    expect(screen.getByTestId("nav-count-orders")).toHaveTextContent("13k");
    expect(screen.getByTestId("nav-count-orders")).toHaveAttribute("title", "12500");
  });

  it("keeps the expanded layout within the sidebar width", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: /Main/i });
    const ordersRow = within(nav).getByRole("button", { name: /Orders,\s*12/i });
    expect(ordersRow.className).toContain("w-full");
    expect(screen.getByTestId("nav-count-orders").className).toMatch(/ml-auto/);
  });
});
