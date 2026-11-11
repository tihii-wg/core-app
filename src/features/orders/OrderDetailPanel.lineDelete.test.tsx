import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderLineDeleteButton } from "./OrderLineDeleteButton";
import { showOrderLineDeletedToast } from "./orderLineDeleteToast";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastDismiss = vi.hoisted(() => vi.fn());

vi.mock("react-hot-toast", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    dismiss: (...args: unknown[]) => toastDismiss(...args),
    error: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "orders.lineDelete.ariaLabel": "Delete",
        "orders.lineDelete.deleted": "Deleted",
        "orders.lineDelete.undo": "Undo",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string) => {
      const map: Record<string, string> = {
        "orders.lineDelete.deleted": "Deleted",
        "orders.lineDelete.undo": "Undo",
        "common.somethingWentWrong": "Something went wrong",
      };
      return map[key] ?? key;
    },
  },
}));

describe("OrderLineDeleteButton", () => {
  it("exposes the delete aria-label and test id", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<OrderLineDeleteButton testId="service-line-delete-svc-1" onClick={onClick} />);
    const button = screen.getByTestId("service-line-delete-svc-1");
    expect(button).toHaveAttribute("aria-label", "Delete");
    await user.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("showOrderLineDeletedToast", () => {
  it("opens a success toast with undo that runs the callback", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    showOrderLineDeletedToast(onUndo);
    expect(toastSuccess).toHaveBeenCalled();
    const renderer = toastSuccess.mock.calls[0]?.[0] as (t: { id: string }) => React.ReactNode;
    const { container } = render(<>{renderer({ id: "toast-1" })}</>);
    expect(container).toHaveTextContent("Deleted");
    await user.click(screen.getByTestId("order-line-delete-undo"));
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    expect(onUndo).toHaveBeenCalled();
  });
});
