import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OrderInlineField, type OrderInlineFieldHandle, type OrderInlineFieldProps } from "./OrderInlineField";

type HarnessProps = Partial<Omit<OrderInlineFieldProps, "isEditing" | "onRequestEdit" | "onCancel">> & {
  onRequestEdit?: () => void;
  onCancel?: () => void;
  startEditing?: boolean;
  fieldRef?: React.Ref<OrderInlineFieldHandle>;
};

/** Owns `isEditing` like OrderDetailPanel does (one open editor, parent closes on success). */
function Harness({ startEditing = false, onRequestEdit, onCancel, onSave, fieldRef, ...props }: HarnessProps) {
  const [isEditing, setIsEditing] = useState(startEditing);
  return (
    <dl>
      <OrderInlineField
        ref={fieldRef}
        label="Description"
        fieldKey="description"
        value="Noise"
        editValue="Noise"
        editable
        {...props}
        isEditing={isEditing}
        onRequestEdit={() => {
          onRequestEdit?.();
          setIsEditing(true);
        }}
        onCancel={() => {
          onCancel?.();
          setIsEditing(false);
        }}
        onSave={async (next) => {
          await onSave?.(next);
          setIsEditing(false);
        }}
      />
    </dl>
  );
}

describe("OrderInlineField", () => {
  it("renders plain text without a button when not editable", () => {
    render(<Harness editable={false} />);

    expect(screen.getByText("Noise")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for an empty value when not editable", () => {
    const { container } = render(<Harness editable={false} value="" editValue="" />);
    expect(container.querySelector("dl")).toBeEmptyDOMElement();
  });

  it("shows an edit button with the value and the aria label when editable", () => {
    render(<Harness />);

    const button = screen.getByRole("button", { name: "Edit: Description" });
    expect(button).toHaveTextContent("Noise");
    expect(button).toHaveClass("hover:bg-muted/50", "cursor-text");
  });

  it("shows the muted placeholder when empty and editable", () => {
    render(<Harness value="" editValue="" />);

    expect(screen.getByRole("button", { name: "Edit: Description" })).toHaveTextContent("+ Add");
  });

  it("opens the editor on click with the current value focused", async () => {
    const user = userEvent.setup();
    const onRequestEdit = vi.fn();
    render(<Harness onRequestEdit={onRequestEdit} />);

    await user.click(screen.getByRole("button", { name: "Edit: Description" }));

    expect(onRequestEdit).toHaveBeenCalledTimes(1);
    const input = screen.getByRole("textbox", { name: "Description" });
    expect(input).toHaveValue("Noise");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancels on Escape without saving", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(<Harness startEditing onCancel={onCancel} onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Description" }), " more");
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit: Description" })).toHaveTextContent("Noise");
  });

  it("cancels with the Cancel button", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness startEditing onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter for single-line fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness startEditing onSave={onSave} />);

    const input = screen.getByRole("textbox", { name: "Description" });
    await user.clear(input);
    await user.type(input, "Brakes{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Brakes"));
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("saves with the Save button", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness startEditing onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Description" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Noise!"));
  });

  it("only saves a textarea with Ctrl/Cmd+Enter; plain Enter adds a line", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness startEditing kind="textarea" onSave={onSave} />);

    const textarea = screen.getByRole("textbox", { name: "Description" });
    await user.type(textarea, "{Enter}second");
    expect(onSave).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Noise\nsecond");

    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Noise\nsecond"));
  });

  it("treats an unchanged value as cancel instead of saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<Harness startEditing onSave={onSave} onCancel={onCancel} />);

    await user.keyboard("{Enter}");

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty value for required fields and shows the message under the control", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness startEditing required onSave={onSave} />);

    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("This field is required");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the editor open and shows the error when saving fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("Boom"));
    render(<Harness startEditing onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Description" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });

  it("disables the control and actions while saving", () => {
    render(<Harness startEditing saving />);

    expect(screen.getByRole("textbox", { name: "Description" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("reports dirty state while editing and clears it on unmount", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<Harness startEditing onDirtyChange={onDirtyChange} />);

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.type(screen.getByRole("textbox", { name: "Description" }), "!");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Escape}");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("passes numbers through as text from a number control", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness startEditing kind="number" label="Mileage" fieldKey="vehicleCurrentMileage" value="100" editValue={100} onSave={onSave} />);

    const input = screen.getByRole("spinbutton", { name: "Mileage" });
    expect(input).toHaveValue(100);
    await user.clear(input);
    await user.type(input, "250{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("250"));
  });

  it("masks the value until revealed and edits the real value", async () => {
    const user = userEvent.setup();
    render(<Harness masked label="Passcode" fieldKey="devicePasscode" value="1234" editValue="1234" />);

    expect(screen.getByRole("button", { name: "Edit: Passcode" })).toHaveTextContent("••••••••");
    expect(screen.queryByText("1234")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show passcode" }));
    expect(screen.getByRole("button", { name: "Edit: Passcode" })).toHaveTextContent("1234");

    await user.click(screen.getByRole("button", { name: "Edit: Passcode" }));
    expect(screen.getByRole("textbox", { name: "Passcode" })).toHaveValue("1234");
  });

  it("saves a checkbox toggle as a boolean", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness startEditing kind="checkbox" label="Paid deposit" fieldKey="custom:deposit" value="—" editValue={false} onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Paid deposit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(true));
  });

  describe("imperative save()", () => {
    it("saves a dirty draft and resolves true", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      const ref = createRef<OrderInlineFieldHandle>();
      render(<Harness startEditing fieldRef={ref} onSave={onSave} />);

      await user.type(screen.getByRole("textbox", { name: "Description" }), "!");
      await expect(ref.current!.save()).resolves.toBe(true);

      expect(onSave).toHaveBeenCalledWith("Noise!");
    });

    it("resolves true and closes the editor when the draft is clean", async () => {
      const onSave = vi.fn();
      const onCancel = vi.fn();
      const ref = createRef<OrderInlineFieldHandle>();
      render(<Harness startEditing fieldRef={ref} onSave={onSave} onCancel={onCancel} />);

      await expect(ref.current!.save()).resolves.toBe(true);

      expect(onSave).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("resolves false and keeps the editor open with the error when saving fails", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockRejectedValue(new Error("Boom"));
      const ref = createRef<OrderInlineFieldHandle>();
      render(<Harness startEditing fieldRef={ref} onSave={onSave} />);

      await user.type(screen.getByRole("textbox", { name: "Description" }), "!");
      await expect(ref.current!.save()).resolves.toBe(false);

      expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
      expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    });

    it("resolves false for an empty required field without saving", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const ref = createRef<OrderInlineFieldHandle>();
      render(<Harness startEditing required fieldRef={ref} onSave={onSave} />);

      await user.clear(screen.getByRole("textbox", { name: "Description" }));
      await expect(ref.current!.save()).resolves.toBe(false);

      expect(onSave).not.toHaveBeenCalled();
      expect(await screen.findByRole("alert")).toHaveTextContent("This field is required");
    });
  });
});
