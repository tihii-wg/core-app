import { Inbox } from "lucide-react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { Stage9ListPage } from "./Stage9ListPage";

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("../reports/reportFormatting", () => ({
  useReportFormatting: () => ({ formatDate: (value: string) => value }),
}));

describe("Stage9ListPage delete confirm", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("asks via the custom dialog and deletes only after confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderWithQuery(
      <Stage9ListPage
        module="leads"
        table="leads"
        icon={Inbox}
        columns={[{ key: "name", header: "Name", cell: (row: { name: string }) => row.name }]}
        keyExtractor={(row: { id: string }) => row.id}
        data={{ rows: [{ id: "lead-1", name: "Ada" }], isUnavailable: false }}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onDelete={onDelete}
        rowLabel={(row: { name: string }) => row.name}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    await user.click(await screen.findByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ id: "lead-1", name: "Ada" }));
  });
});
