import toast from "react-hot-toast";
import i18n from "../../i18n";

const UNDO_MS = 6000;

/**
 * "Deleted" toast with an Undo action. Calling undo dismisses the toast and runs the callback.
 */
export function showOrderLineDeletedToast(onUndo: () => void | Promise<void>) {
  toast.success(
    (toastId) => (
      <span className="inline-flex items-center gap-3" data-testid="order-line-deleted-toast">
        <span>{i18n.t("orders.lineDelete.deleted")}</span>
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          data-testid="order-line-delete-undo"
          onClick={() => {
            toast.dismiss(toastId.id);
            void Promise.resolve(onUndo()).catch((error) => {
              const message = error instanceof Error && error.message ? error.message : i18n.t("common.somethingWentWrong");
              toast.error(message);
            });
          }}
        >
          {i18n.t("orders.lineDelete.undo")}
        </button>
      </span>
    ),
    { duration: UNDO_MS, id: "order-line-deleted" },
  );
}
