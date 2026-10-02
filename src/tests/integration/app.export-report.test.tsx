import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  Object.assign(row("orders", "order-b1")!, { created_at: daysAgo(1), number: "ORD-BETA" });
});

afterEach(() => {
  unhandled.stop();
  vi.restoreAllMocks();
});

async function openExportDialog() {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(reportsPath);
  await screen.findByText("Reports & Analytics");
  await app.user.click(screen.getByRole("button", { name: "Export" }));
  const dialog = await screen.findByRole("dialog", { name: "Export report" });
  return { ...app, dialog };
}

function captureCsv() {
  const exported: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    exported.push(blob);
    return "blob:report";
  });
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const text = () =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exported[0]);
    });
  return { click, text };
}

function holdRequests(table: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const from = fake.client.from;
  vi.spyOn(fake.client, "from").mockImplementation((name: string) => {
    const query = from(name);
    if (name === table) {
      const then = query.then.bind(query);
      query.then = ((onFulfilled, onRejected) => gate.then(() => then(onFulfilled, onRejected))) as typeof query.then;
    }
    return query;
  });
  return () => {
    vi.mocked(fake.client.from).mockRestore();
    release();
  };
}

describe("reports export dialog", () => {
  it("opens with every section selected and previews the workspace's data for the selected period", async () => {
    const { dialog } = await openExportDialog();

    expect(within(dialog).getByText("Last 30 days")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Select all" })).toBeChecked();
    for (const label of ["Orders", "Clients", "Employees", "Inventory", "Revenue / financial data", "Services", "Summary / key metrics"]) {
      expect(within(dialog).getByRole("checkbox", { name: new RegExp(`^${label.replace("/", "\\/")}`) })).toBeChecked();
    }
    expect(within(dialog).getByRole("radio", { name: /^PDF/ })).toBeChecked();

    const preview = within(dialog).getByRole("complementary", { name: "Export preview" });
    expect(within(preview).getByText("7 of 7")).toBeInTheDocument();
    expect(await within(preview).findByText("1 order")).toBeInTheDocument();
    expect(within(preview).getByText("1 service")).toBeInTheDocument();
    expect(within(preview).getByText("1 active item, 1 needs attention")).toBeInTheDocument();
    expect(within(preview).getByText("Alpha Garage")).toBeInTheDocument();
  });

  it("selects and clears all sections and requires at least one", async () => {
    const { user, dialog } = await openExportDialog();
    const selectAll = within(dialog).getByRole("checkbox", { name: "Select all" });

    await user.click(within(dialog).getByRole("checkbox", { name: /^Inventory/ }));
    expect(selectAll).not.toBeChecked();
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    expect(within(dialog).getByText("6 of 7")).toBeInTheDocument();

    await user.click(selectAll);
    expect(within(dialog).getByRole("checkbox", { name: /^Inventory/ })).toBeChecked();

    await user.click(selectAll);
    expect(within(dialog).getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByText("Select at least one section to export.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("prints a PDF report with fresh workspace data and stays on the Reports page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { user, dialog, location } = await openExportDialog();
    await within(dialog).findByText("1 order");
    const requestsBefore = fake.requests.length;

    await user.click(within(dialog).getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(location.pathname).toBe(reportsPath);
    expect(document.title).toMatch(/^Business Report – Alpha Garage – /);

    const refetched = fake.requests.slice(requestsBefore).filter((request) => request.op === "select");
    for (const table of ["orders", "clients", "employees", "inventory_items_with_status"]) {
      expect(refetched.some((request) => request.table === table && request.filters.includes(`workspace_id=eq.${WS.A}`))).toBe(true);
    }

    const report = document.querySelector("[data-report-print-root] article") as HTMLElement;
    expect(report).toHaveAccessibleName("Business Report");
    expect(within(report).getByRole("region", { name: "Key figures" })).toBeInTheDocument();
    expect(within(within(report).getByRole("region", { name: "Orders" })).getByText(orderNumber)).toBeInTheDocument();
    expect(within(within(report).getByRole("region", { name: "Performance by employee" })).getByText("Tom Tech")).toBeInTheDocument();
    expect(within(within(report).getByRole("region", { name: "Stock list" })).getByText("Alpha brake pads")).toBeInTheDocument();
    expect(within(report).queryByText("ORD-BETA")).not.toBeInTheDocument();
    expect(within(report).queryByText("Beta filter")).not.toBeInTheDocument();

    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(document.querySelector("[data-report-print-root]")).toBeNull());
    expect(document.title).not.toMatch(/^Business Report/);
  });

  it("exports only the selected sections as CSV for the selected date range", async () => {
    Object.assign(row("orders", "order-a1")!, { created_at: daysAgo(60) });
    const csv = captureCsv();
    fake.signInAs(USERS.owner.id);
    const { user, location } = renderApp(reportsPath);
    await screen.findByText("Reports & Analytics");

    await user.click(within(screen.getByRole("main")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Last 90 days" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export report" });
    expect(within(dialog).getByText("Last 90 days")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: "Select all" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /^Orders/ }));
    await user.click(within(dialog).getByRole("radio", { name: /^CSV/ }));
    await user.click(within(dialog).getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(csv.click).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Report exported")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(location.pathname).toBe(reportsPath);

    const text = await csv.text();
    expect(text).toContain("Business Report");
    expect(text).toContain("Workspace,Alpha Garage");
    expect(text).toContain(`${orderNumber},`);
    expect(text).toContain("Orders by status");
    expect(text).not.toContain("Key figures");
    expect(text).not.toContain("Stock list");
    expect(text).not.toContain("ORD-BETA");
  });

  it("opens the print dialog only after the export dialog has closed, and reopens normally after printing is cancelled", async () => {
    const dialogPresentAtPrint: boolean[] = [];
    vi.spyOn(window, "print").mockImplementation(() => {
      dialogPresentAtPrint.push(Boolean(document.querySelector("[role=dialog]")));
    });
    const { user, dialog } = await openExportDialog();
    await within(dialog).findByText("1 order");

    await user.click(within(dialog).getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(dialogPresentAtPrint).toEqual([false]));
    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(document.querySelector("[data-report-print-root]")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Export" }));
    let reopened = await screen.findByRole("dialog", { name: "Export report" });
    expect(within(reopened).getByRole("button", { name: "Export PDF" })).toBeEnabled();
    expect(within(reopened).getByRole("checkbox", { name: "Select all" })).toBeEnabled();
    await user.click(within(reopened).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Export" }));
    reopened = await screen.findByRole("dialog", { name: "Export report" });
    await user.click(within(reopened).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("can be closed while the report is generating, and discards the cancelled export", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { user, dialog } = await openExportDialog();
    await within(dialog).findByText("1 order");
    const release = holdRequests("orders");

    await user.click(within(dialog).getByRole("button", { name: "Export PDF" }));
    expect(await within(dialog).findByRole("button", { name: /Generating report/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector("[data-report-print-root]")).toBeNull();

    const releaseAgain = holdRequests("orders");
    await user.click(screen.getByRole("button", { name: "Export" }));
    const reopened = await screen.findByRole("dialog", { name: "Export report" });
    expect(within(reopened).getByRole("button", { name: "Export PDF" })).toBeEnabled();
    await user.click(within(reopened).getByRole("button", { name: "Export PDF" }));
    await within(reopened).findByRole("button", { name: /Generating report/ });
    await user.click(within(reopened).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    releaseAgain();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(print).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the dialog open when the report cannot be generated", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { user, dialog } = await openExportDialog();
    await within(dialog).findByText("1 order");
    fake.failNext("orders", "select", { code: "PGRST000", message: "connection lost" });

    await user.click(within(dialog).getByRole("button", { name: "Export PDF" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Could not generate the report.");
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Export report" })).toBeInTheDocument();
    expect(document.querySelector("[data-report-print-root]")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
