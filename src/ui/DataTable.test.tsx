import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable, type Column } from "./DataTable";

type Row = { id: string; name: string };

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (row) => row.name },
  { key: "actions", header: "Actions", stickyRight: true, className: "w-[104px] text-right", cell: () => <button type="button">Menu</button> },
];

describe("DataTable sticky right column", () => {
  it("pins only the opt-in column to the right with an opaque background", () => {
    render(<DataTable columns={columns} data={[{ id: "1", name: "Alpha" }]} keyExtractor={(row) => row.id} />);

    const head = screen.getByRole("columnheader", { name: "Actions" });
    expect(head.className).toContain("sticky");
    expect(head.className).toContain("right-0");
    expect(head.className).toContain("bg-muted");

    const cell = screen.getByRole("button", { name: "Menu" }).closest("td");
    expect(cell?.className).toContain("sticky");
    expect(cell?.className).toContain("right-0");
    expect(cell?.className).toContain("bg-card");

    const nameHead = screen.getByRole("columnheader", { name: "Name" });
    expect(nameHead.className).not.toContain("sticky");
  });

  it("keeps the table inside a horizontal scroll container", () => {
    const { container } = render(<DataTable columns={columns} data={[{ id: "1", name: "Alpha" }]} keyExtractor={(row) => row.id} />);
    const scroller = container.querySelector('[data-slot="table-container"]');
    expect(scroller?.className).toContain("overflow-x-auto");
  });
});
