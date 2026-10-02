import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";
import { localDateKey } from "../../pages/dashboardStats";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const reportsPath = `/en/${WS.A}/reports`;
let unhandled: ReturnType<typeof trackUnhandledRejections>;

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${localDateKey(date)}T12:00:00.000Z`;
}

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openReports() {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(reportsPath);
  await screen.findByText("Reports & Analytics");
  return app;
}

function statValue(title: string) {
  return screen.getByText(title, { selector: "p" }).previousElementSibling?.textContent;
}

describe("reports page", () => {
  it("shows the active workspace's orders, revenue and clients for the selected period", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(0), is_paid: true, status: "paid", total_price: 40 });
    fake.all("orders").push({ ...row("orders", "order-a1")!, id: "order-a-old", number: "ORD-OLD", created_at: daysAgo(60), is_paid: false, status: "new", total_price: 60 });
    Object.assign(row("clients", "client-a1")!, { created_at: daysAgo(1) });
    Object.assign(row("orders", "order-b1")!, { created_at: daysAgo(0), is_paid: true, total_price: 999 });
    const { user } = await openReports();

    await waitFor(() => expect(statValue("Total Orders")).toBe("1"));
    expect(statValue("New Clients")).toBe("1");
    expect(statValue("Total Revenue")).toMatch(/40/);
    expect(statValue("Avg Order Value")).toMatch(/40/);
    expect(statValue("Total Revenue")).not.toMatch(/999/);

    const rangeSelect = within(screen.getByRole("main")).getByRole("combobox");
    expect(rangeSelect).toHaveTextContent("Last 30 days");
    await user.click(rangeSelect);
    await user.click(await screen.findByRole("option", { name: "Last 90 days" }));

    expect(statValue("Total Orders")).toBe("2");
    expect(statValue("Avg Order Value")).toMatch(/50/);
    expect(screen.getByText("Weekly Revenue")).toBeInTheDocument();
    expect(unhandled.rejections).toEqual([]);
  });

  it("shows placeholders instead of charts when the period has no data", async () => {
    await openReports();

    expect(await screen.findAllByText("No data available yet")).toHaveLength(2);
    expect(screen.getAllByText("No orders were created in this period.")).toHaveLength(2);
    expect(statValue("Total Orders")).toBe("0");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("ranks the services performed in the period", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(2) });
    const { user } = await openReports();

    await user.click(await screen.findByRole("tab", { name: /Services/ }));

    const topServices = screen.getByText("Top Performing Services").closest("[data-slot=card]") as HTMLElement;
    expect(await within(topServices).findByText("Oil change")).toBeInTheDocument();
    expect(within(topServices).getByText("100%")).toBeInTheDocument();
  });

  it("shows a placeholder for employee performance until assigned orders are completed", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(2) });
    const { user } = await openReports();

    await user.click(await screen.findByRole("tab", { name: /Employees/ }));
    expect(await screen.findByText("No orders assigned to employees were completed in this period.")).toBeInTheDocument();
  });

  it("charts completed orders per assigned employee", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(2), status: "completed" });
    const { user } = await openReports();

    await user.click(await screen.findByRole("tab", { name: /Employees/ }));
    const card = screen.getByText("Employee Performance").closest("[data-slot=card]") as HTMLElement;
    await waitFor(() => expect(card.querySelector(".recharts-responsive-container")).not.toBeNull());
    expect(within(card).queryByText(/No orders assigned/)).not.toBeInTheDocument();
    expect(within(card).queryByText("No data available yet")).not.toBeInTheDocument();
  });

  it("explains that inventory trends are not recorded and shows current stock levels", async () => {
    const { user } = await openReports();

    await user.click(await screen.findByRole("tab", { name: /Inventory/ }));

    expect(await screen.findByText("Stock history and parts usage are not recorded yet, so trends cannot be shown.")).toBeInTheDocument();
    const stock = screen.getByText("Current Stock Levels").closest("[data-slot=card]") as HTMLElement;
    await waitFor(() => expect(stock.querySelector(".recharts-responsive-container")).not.toBeNull());
    expect(within(stock).queryByText("No data available yet")).not.toBeInTheDocument();
  });

  it("shows a placeholder for current stock in a workspace without inventory", async () => {
    fake.all("inventory_items").splice(0, fake.all("inventory_items").length, ...fake.all("inventory_items").filter((item) => item.workspace_id !== WS.A));
    const { user } = await openReports();

    await user.click(await screen.findByRole("tab", { name: /Inventory/ }));

    expect(await screen.findByText("No active inventory items in this workspace.")).toBeInTheDocument();
  });
});
