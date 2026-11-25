import { useEffect } from "react";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { isDuplicateOpenVinError } from "../../services/apiOrders";

/** Window event asking the app to open an order card (handled once, inside the router, by OpenOrderRequestListener). */
export const OPEN_ORDER_REQUEST_EVENT = "core-app:open-order";

export type OpenOrderRequestDetail = { orderId: string };

export function requestOpenOrder(orderId: string) {
  window.dispatchEvent(new CustomEvent<OpenOrderRequestDetail>(OPEN_ORDER_REQUEST_EVENT, { detail: { orderId } }));
}

/** Calls `handler` whenever some toast/link asks to open an order (e.g. to close a create dialog first). */
export function useOpenOrderRequest(handler: (orderId: string) => void) {
  useEffect(() => {
    const listener = (event: Event) => {
      const orderId = (event as CustomEvent<OpenOrderRequestDetail>).detail?.orderId;
      if (orderId) handler(orderId);
    };
    window.addEventListener(OPEN_ORDER_REQUEST_EVENT, listener);
    return () => window.removeEventListener(OPEN_ORDER_REQUEST_EVENT, listener);
  }, [handler]);
}

/**
 * Error toast for order writes. A duplicate open-order VIN gets the conflicting order number as a
 * clickable link that opens that order; any other error is a plain toast. Returns true when handled.
 */
export function toastOrderWriteError(error: unknown, toastId: string, fallback: string) {
  if (isDuplicateOpenVinError(error) && error.existingOrderId) {
    const orderId = error.existingOrderId;
    const number = error.existingOrderNumber ?? "";
    toast.error(
      (item) => (
        <span className="flex flex-col gap-1">
          <span>{error.message}</span>
          <button
            type="button"
            className="self-start font-medium text-primary underline underline-offset-2"
            onClick={() => {
              toast.dismiss(item.id);
              requestOpenOrder(orderId);
            }}
          >
            {i18n.t("orders.errors.openExistingOrder", { number })}
          </button>
        </span>
      ),
      { id: toastId, duration: 10_000 },
    );
    return;
  }
  toast.error(error instanceof Error && error.message ? error.message : fallback, { id: toastId });
}
