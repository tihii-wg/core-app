import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceRealtime } from "./WorkspaceRealtimeProvider";

/**
 * While an order edit form is open and dirty, a realtime orders-touch shows a
 * non-blocking notice instead of overwriting form state.
 */
export function useRemoteOrderEditNotice(orderId: string, isDirty: boolean) {
  const { ordersTouchAt } = useWorkspaceRealtime();
  const baselineRef = useRef(ordersTouchAt);
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    baselineRef.current = ordersTouchAt;
    setShowNotice(false);
  }, [orderId]);

  useEffect(() => {
    if (!isDirty) {
      baselineRef.current = ordersTouchAt;
      setShowNotice(false);
      return;
    }
    if (ordersTouchAt > baselineRef.current) {
      setShowNotice(true);
    }
  }, [ordersTouchAt, isDirty]);

  const dismiss = useCallback(() => {
    baselineRef.current = ordersTouchAt;
    setShowNotice(false);
  }, [ordersTouchAt]);

  const acknowledgeReload = useCallback(() => {
    baselineRef.current = ordersTouchAt;
    setShowNotice(false);
  }, [ordersTouchAt]);

  return { showNotice, dismiss, acknowledgeReload };
}
