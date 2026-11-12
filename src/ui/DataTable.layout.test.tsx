import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { stubLocalStorage } from "../tests/memoryStorage";
import { DataTable, type Column } from "./DataTable";
import { readTableColumnLayout, writeTableColumnLayout } from "./tableColumnLayout";

type Row = { id: string; name: string; city: string };

const STORAGE_KEY = "test.datatable.columnLayout";

const columns: Column<Row>[] = [
  { key: "name", header: "Name", defaultWidth: 120, cell: (row) => row.name },
  { key: "city", header: "City", defaultWidth: 140, flexible: true, cell: (row) => row.city },
  {
    key: "actions",
    header: "Actions",
    defaultWidth: 80,
    resizable: false,
    reorderable: false,
    stickyRight: true,
    cell: () => <button type="button">Menu</button>,
  },
];

const rows: Row[] = [
  { id: "1", name: "Ada", city: "London" },
  { id: "2", name: "Grace", city: "NYC" },
];

function renderTable(props?: { layoutEpoch?: number }) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.id}
        resizable
        reorderable
        layoutStorageKey={STORAGE_KEY}
        layoutEpoch={props?.layoutEpoch}
        flexibleColumnId="city"
        pinnedEndColumnIds={["actions"]}
      />
    </I18nextProvider>,
  );
}

describe("DataTable column layout", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("commits width on pointer up and restores from storage", () => {
    const { unmount } = renderTable();
    const handle = screen.getByTestId("col-resize-name");
    const col = document.querySelector('col[data-col-id="name"]') as HTMLTableColElement;
    expect(col).toBeTruthy();

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1, buttons: 1 });
    // Live drag updates the <col> without requiring a React commit yet.
    expect(Number.parseInt(col.style.width, 10)).toBeGreaterThan(120);
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 });

    const stored = readTableColumnLayout(STORAGE_KEY);
    expect(stored?.widths.name).toBeGreaterThan(120);

    unmount();
    renderTable();
    const colAfter = document.querySelector('col[data-col-id="name"]') as HTMLTableColElement;
    expect(Number.parseInt(colAfter.style.width, 10)).toBe(stored!.widths.name);
  });

  it("double-click on the resize handle resets one column to its default width", () => {
    writeTableColumnLayout(STORAGE_KEY, {
      order: ["name", "city", "actions"],
      widths: { name: 300, city: 140, actions: 80 },
    });
    renderTable();
    const handle = screen.getByTestId("col-resize-name");
    fireEvent.doubleClick(handle);
    const stored = readTableColumnLayout(STORAGE_KEY);
    expect(stored?.widths.name).toBe(120);
  });

  it("does not render a resize handle on the actions column", () => {
    renderTable();
    expect(screen.queryByTestId("col-resize-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("col-resize-name")).toBeInTheDocument();
  });

  it("ignores unknown stored columns and keeps actions last", () => {
    writeTableColumnLayout(STORAGE_KEY, {
      order: ["city", "ghost", "actions", "name"],
      widths: { city: 200, ghost: 50, name: 120, actions: 80 },
    });
    renderTable();
    const ids = [...document.querySelectorAll("thead th[data-col-id]")].map((node) => node.getAttribute("data-col-id"));
    expect(ids).toEqual(["city", "name", "actions"]);
  });

  it("exposes a keyboard focus target on reorderable headers and persists a reordered layout", () => {
    const first = renderTable();
    const nameHead = document.querySelector('th[data-col-id="name"]') as HTMLElement;
    const focusable = nameHead.querySelector("[tabindex]") as HTMLElement | null;
    expect(focusable).toBeTruthy();
    expect(focusable).toHaveAttribute("tabindex", "0");
    // Actions stays non-sortable (no tabindex drag handle from dnd-kit).
    const actionsHead = document.querySelector('th[data-col-id="actions"]') as HTMLElement;
    expect(actionsHead.querySelector("[tabindex='0']")).toBeNull();
    first.unmount();

    writeTableColumnLayout(STORAGE_KEY, {
      order: ["city", "name", "actions"],
      widths: { name: 120, city: 140, actions: 80 },
    });
    renderTable();
    const ids = [...document.querySelectorAll("thead th[data-col-id]")].map((node) => node.getAttribute("data-col-id"));
    expect(ids).toEqual(["city", "name", "actions"]);
    expect(readTableColumnLayout(STORAGE_KEY)?.order).toEqual(["city", "name", "actions"]);
  });

  it("reloads defaults when layoutEpoch bumps after storage clear", () => {
    writeTableColumnLayout(STORAGE_KEY, {
      order: ["city", "name", "actions"],
      widths: { name: 280, city: 140, actions: 80 },
    });
    const { rerender } = renderTable({ layoutEpoch: 0 });
    expect(Number.parseInt((document.querySelector('col[data-col-id="name"]') as HTMLTableColElement).style.width, 10)).toBe(
      280,
    );
    window.localStorage.removeItem(STORAGE_KEY);
    rerender(
      <I18nextProvider i18n={i18n}>
        <DataTable
          columns={columns}
          data={rows}
          keyExtractor={(row) => row.id}
          resizable
          reorderable
          layoutStorageKey={STORAGE_KEY}
          layoutEpoch={1}
          flexibleColumnId="city"
          pinnedEndColumnIds={["actions"]}
        />
      </I18nextProvider>,
    );
    expect(Number.parseInt((document.querySelector('col[data-col-id="name"]') as HTMLTableColElement).style.width, 10)).toBe(
      120,
    );
    const ids = [...document.querySelectorAll("thead th")].map(
      (node) => node.getAttribute("data-col-id") ?? (node.hasAttribute("data-table-spacer") ? "spacer" : null),
    );
    // The empty spacer takes leftover width right before the pinned actions column.
    expect(ids).toEqual(["name", "city", "spacer", "actions"]);
  });
});

describe("OrderColumnsMenu reset wiring", () => {
  it("exposes a reset layout action when onResetLayout is provided", async () => {
    const { OrderColumnsMenu } = await import("../features/orders/OrderColumnsMenu");
    const onResetLayout = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <OrderColumnsMenu
          visibleColumns={new Set(["client", "status"])}
          onVisibleColumnsChange={() => undefined}
          deviceColumnLabel="Device"
          onResetLayout={onResetLayout}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: /columns|колонки|coloane/i }));
    const item = await screen.findByTestId("order-columns-reset-layout");
    await user.click(item);
    expect(onResetLayout).toHaveBeenCalled();
    expect(within(item).getByText(/reset|сбросить|resetează/i)).toBeTruthy();
  });
});
