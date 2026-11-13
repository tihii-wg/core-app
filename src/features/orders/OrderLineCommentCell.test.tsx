import { describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useState, type ComponentProps } from "react";
import i18n from "../../i18n";
import { OrderLineCommentButton } from "./OrderLineCommentButton";
import { OrderLineCommentCell } from "./OrderLineCommentCell";

type CellProps = ComponentProps<typeof OrderLineCommentCell>;

/** Row-like harness: the always-visible comment button opens the cell's editor (as in the order card rows). */
function Harness(props: Omit<CellProps, "editing" | "onEditingChange">) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {props.editable && props.visible ? (
        <OrderLineCommentButton
          testId="comment-button"
          hasComment={Boolean(props.comment?.trim())}
          active={editing}
          onClick={() => setEditing(true)}
        />
      ) : null}
      <OrderLineCommentCell {...props} editing={editing} onEditingChange={setEditing} />
    </>
  );
}

function renderCell(overrides: Partial<Omit<CellProps, "editing" | "onEditingChange">> = {}) {
  const onSave: Mock = (overrides.onSave as Mock) ?? vi.fn(async () => undefined);
  const result = render(
    <I18nextProvider i18n={i18n}>
      <Harness comment={null} visible editable onSave={onSave} {...overrides} />
    </I18nextProvider>,
  );
  return { onSave, ...result };
}

describe("OrderLineCommentCell", () => {
  it("shows nothing under the name when empty — the comment button opens the editor", async () => {
    const user = userEvent.setup();
    renderCell();
    expect(screen.queryByTestId("order-line-comment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-line-comment-editor")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("comment-button"));
    expect(screen.getByTestId("order-line-comment-editor")).toBeInTheDocument();
  });

  it("saves on Enter", async () => {
    const user = userEvent.setup();
    const { onSave } = renderCell();
    await user.click(screen.getByTestId("comment-button"));
    const textarea = screen.getByTestId("order-line-comment-editor").querySelector("textarea");
    expect(textarea).toBeTruthy();
    await user.type(textarea!, "Needs OEM filter");
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith("Needs OEM filter");
  });

  it("cancels on Escape without saving", async () => {
    const user = userEvent.setup();
    const { onSave } = renderCell({ comment: "Existing" });
    await user.click(screen.getByTestId("order-line-comment"));
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
    await user.click(screen.getByTestId("comment-button"));
    const editor = screen.getByTestId("order-line-comment-editor").querySelector("textarea")!;
    await user.clear(editor);
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("read-only viewers see the text only; nothing when not visible", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <Harness comment="Private note" visible editable={false} onSave={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("order-line-comment")).toHaveTextContent("Private note");
    expect(screen.queryByTestId("comment-button")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("order-line-comment"));
    expect(screen.queryByTestId("order-line-comment-editor")).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <Harness comment="Private note" visible={false} editable={false} onSave={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("order-line-comment")).not.toBeInTheDocument();
  });
});
