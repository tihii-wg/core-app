import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { OPEN_ORDER_REQUEST_EVENT, type OpenOrderRequestDetail } from "./duplicateOpenVinToast";

/** Mounted once in the app layout: routes open-order requests to the Orders page deep link (?open=<id>). */
export function OpenOrderRequestListener() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const listener = (event: Event) => {
      const orderId = (event as CustomEvent<OpenOrderRequestDetail>).detail?.orderId;
      if (!orderId) return;
      // /:locale/:workspaceId/… — same deep link the tasks list uses.
      const [, locale, workspaceSegment] = location.pathname.split("/");
      if (!locale || !workspaceSegment) return;
      navigate(`/${locale}/${workspaceSegment}/orders?open=${encodeURIComponent(orderId)}`);
    };
    window.addEventListener(OPEN_ORDER_REQUEST_EVENT, listener);
    return () => window.removeEventListener(OPEN_ORDER_REQUEST_EVENT, listener);
  }, [location.pathname, navigate]);
  return null;
}
