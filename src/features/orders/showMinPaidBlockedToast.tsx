import toast from "react-hot-toast";
import type { MinPaidBlock } from "./minPaidStatusGuard";

const TOAST_ID = "min-paid-required";

/**
 * Shows the min-paid block explanation as a toast, with an optional «Record payment» action.
 * `recordPaymentLabel` should be t("orders.minPaid.recordPayment").
 */
export function showMinPaidBlockedToast(opts: {
  block: Pick<MinPaidBlock, "message">;
  recordPaymentLabel: string;
  onRecordPayment?: () => void;
}) {
  const { block, recordPaymentLabel, onRecordPayment } = opts;
  if (!onRecordPayment) {
    toast.error(block.message, { id: TOAST_ID, duration: 7000 });
    return;
  }
  toast.custom(
    (instance) => (
      <div
        role="alert"
        className="flex max-w-md flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg"
        style={{ opacity: instance.visible ? 1 : 0, transition: "opacity 150ms" }}
      >
        <p className="[overflow-wrap:anywhere]">{block.message}</p>
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"
            onClick={() => {
              toast.dismiss(instance.id);
              onRecordPayment();
            }}
          >
            {recordPaymentLabel}
          </button>
        </div>
      </div>
    ),
    { id: TOAST_ID, duration: 9000 },
  );
}
