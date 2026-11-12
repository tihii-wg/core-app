import { describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { ComponentProps } from "react";
import i18n from "../../i18n";
import { OrderLineCommentCell } from "./OrderLineCommentCell";

function renderCell(overrides: Partial<ComponentProps<typeof OrderLineCommentCell>> = {}) {
  const onSave: Mock = (overrides.onSave as Mock) ?? vi.fn(async () => undefined);
  const result = render(
    <I18nextProvider i18n={i18n}>
      <div className="group/line">
        <OrderLineCommentCell comment={null} visible editable onSave={onSave} {...overrides} />
      </div>
    </I18nextProvider>,
  );
  return { onSave, ...result };
}

describe("OrderLineCommentCell", () => {
  it("shows the add link when editable and empty", () => {
    renderCell();
    expect(screen.getByTestId("order-line-comment-add")).toBeInTheDocument();
  });

  it("saves on Enter", async () => {
    const user = userEvent.setup();
    const { onSave } = renderCell();
    await user.click(screen.getByTestId("order-line-comment-add"));
    const textarea = screen.getByTestId("order-line-comment-editor").querySelector("textarea");
    expect(textarea).toBeTruthy();
    await user.type(textarea!, "Needs OEM filter");
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith("Needs OEM filter");
  });

  it("cancels on Escape without saving", async () => {
    const user = userEvent.setup();
    const { onSave } = renderCell({ comment: "Existing" });
    await user.click(screen.getByTestId("order-line-comment-edit"));
    const editor = screen.getByTestId("order-line-comment-editor").querySelector("textarea")!;
    await user.clear(editor);
    await user.type(editor, "Changed");
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("order-line-comment")).toHaveTextContent("Existing");
  });

  it("deletes when saving empty body", async () => {
    const user = userEvent.setup();
    const { onSave } = renderCell({ comment: "To remove" });
    await user.click(screen.getByTestId("order-line-comment-edit"));
    const editor = screen.getByTestId("order-line-comment-editor").querySelector("textarea")!;
    await user.clear(editor);
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("hides add/edit for non-editable viewers; hides entirely when not visible", () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <OrderLineCommentCell comment="Private note" visible editable={false} onSave={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("order-line-comment")).toHaveTextContent("Private note");
    expect(screen.queryByTestId("order-line-comment-add")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-line-comment-edit")).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <OrderLineCommentCell comment={null} visible={false} editable={false} onSave={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("order-line-comment-add")).not.toBeInTheDocument();
  });
});
