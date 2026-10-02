import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";
import { localDateKey } from "../../pages/dashboardStats";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const reportsPath = `/en/${WS.A}/reports`;
const orderNumber = `ORD-${new Date().getFullYear()}-001`;
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
  Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(2) });
});

afterEach(() => {
  unhandled.stop();
  vi.restoreAllMocks();
});

async function openReport(type: string, query = "") {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(`${reportsPath}/${type}${query}`);
  const report = await screen.findByRole("article");
  return { ...app, report };
}

function section(report: HTMLElement, title: string) {
  return within(report).getByRole("region", { name: title });
}

describe("quick reports", () => {
  it("opens each quick report from the Reports page with the selected period", async () => {
    fake.signInAs(USERS.owner.id);
    const { user, location } = renderApp(reportsPath);

    await user.click(await screen.findByRole("button", { name: /Sales Report/ }));

    await waitFor(() => expect(location.pathname).toBe(`${reportsPath}/sales`));
    expect(location.search).toBe("?range=last30");
    const report = await screen.findByRole("article", { name: "Sales Report" });
    expect(within(report).getByRole("heading", { name: "Sales Report" })).toBeInTheDocument();
    expect(within(report).getByText("Alpha Garage")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Back to Reports" }));
    await waitFor(() => expect(location.pathname).toBe(reportsPath));
  });

  it("builds the sales report from the workspace's orders only", async () => {
    Object.assign(row("orders", "order-b1")!, { created_at: daysAgo(1), number: "ORD-BETA" });
    const { report } = await openReport("sales", "?range=last7");

    const orders = section(report, "Orders");
    expect(within(orders).getByText(orderNumber)).toBeInTheDocument();
    expect(within(orders).getByText("Ada Alpha")).toBeInTheDocument();
    expect(within(report).queryByText("ORD-BETA")).not.toBeInTheDocument();
    expect(within(section(report, "Services sold")).getByText("Oil change")).toBeInTheDocument();
    expect(within(section(report, "Top clients")).getByText("Ada Alpha")).toBeInTheDocument();
    expect(within(report).getByText("Period", { selector: "dt" }).nextElementSibling?.textContent).toMatch(/^\S+ – \S+$/);
  });

  it("shows No data available yet for a period without orders and refreshes when the period changes", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(60) });
    const { user, report, location } = await openReport("sales", "?range=last30");

    expect(within(section(report, "Orders")).getByText("No data available yet")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Report period" }));
    await user.click(await screen.findByRole("option", { name: "Last 90 days" }));

    expect(location.search).toBe("?range=last90");
    expect(await within(section(screen.getByRole("article"), "Orders")).findByText(orderNumber)).toBeInTheDocument();
  });

  it("builds the inventory report as a current snapshot with a usage placeholder", async () => {
    const { report } = await openReport("inventory");

    expect(screen.queryByRole("combobox", { name: "Report period" })).not.toBeInTheDocument();
    expect(within(report).getByText(/^As of /)).toBeInTheDocument();
    expect(within(section(report, "Items needing attention")).getByText("Alpha brake pads")).toBeInTheDocument();
    expect(within(section(report, "Stock list")).getByText("AP-1")).toBeInTheDocument();
    expect(within(report).queryByText("Beta filter")).not.toBeInTheDocument();
    const usage = section(report, "Stock movements and parts usage");
    expect(within(usage).getByText("No data available yet")).toBeInTheDocument();
  });

  it("builds the employee report from orders assigned to the workspace's employees", async () => {
    Object.assign(row("orders", "order-a1")!, { status: "completed" });
    const { report } = await openReport("employees");

    const performance = section(report, "Performance by employee");
    const tom = within(performance).getByText("Tom Tech").closest("tr") as HTMLElement;
    expect(within(tom).getByText("Technician")).toBeInTheDocument();
    expect(within(tom).getByText("100%")).toBeInTheDocument();
    expect(within(performance).getByText("Tina Tech")).toBeInTheDocument();
    expect(within(report).queryByText("Bert Beta")).not.toBeInTheDocument();
  });

  it("builds the financial report and marks expenses and invoices as not available", async () => {
    const { report } = await openReport("financial");

    expect(within(section(report, "Outstanding orders")).getByText(orderNumber)).toBeInTheDocument();
    expect(within(section(report, "Expenses and profit")).getByText("No data available yet")).toBeInTheDocument();
    expect(within(section(report, "Invoices")).getByText("No data available yet")).toBeInTheDocument();
  });

  it("prints the report", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { user } = await openReport("sales");

    await user.click(screen.getByRole("button", { name: "Print / PDF" }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(document.title).toMatch(/^Sales Report – Alpha Garage – /);
  });

  it("exports the report as CSV with real values", async () => {
    let exported: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      exported = blob;
      return "blob:report";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = await openReport("inventory");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exported!);
    });
    expect(text).toContain("Inventory Report");
    expect(text).toContain("Workspace,Alpha Garage");
    expect(text).toContain("Alpha brake pads,AP-1");
    expect(text).not.toContain("Beta filter");
  });

  it("copies a shareable link when the system share sheet is not available", async () => {
    const { user } = await openReport("financial", "?range=last90");

    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByText("Report link copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toMatch(new RegExp(`/en/${WS.A}/reports/financial\\?range=last90$`));
  });

  it("returns to the Reports page for an unknown report", async () => {
    fake.signInAs(USERS.owner.id);
    const { location } = renderApp(`${reportsPath}/payroll`);

    await waitFor(() => expect(location.pathname).toBe(reportsPath));
    expect(unhandled.rejections).toEqual([]);
  });
});
