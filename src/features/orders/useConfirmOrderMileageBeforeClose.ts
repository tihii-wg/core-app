import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { Order, Vehicle } from "../../lib/types";
import { updateOrderFields } from "../../services/apiOrders";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import type { ConfirmOrderMileageResult } from "./ConfirmOrderMileageDialog";
import { shouldConfirmMileageBeforeClose } from "./orderVehicleMileage";

/**
 * Soft mileage confirmation gate before opening CloseOrderDialog / closing after payment.
 * Resolves with the (possibly updated) order, or null when the user dismisses the dialog.
 */
export function useConfirmOrderMileageBeforeClose() {
  const { workflow } = useIndustryWorkflow();
  const clientVehicles = industrySupportsClientVehicles(workflow);
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const resolverRef = useRef<((next: Order | null) => void) | null>(null);

  const vehicleId = order?.vehicleId?.trim() || null;
  const { vehicle } = useGetVehicle(open ? vehicleId : null);

  const closeDialog = useCallback((next: Order | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setOrder(null);
    resolve?.(next);
  }, []);

  const ensureConfirmed = useCallback(
    (candidate: Order): Promise<Order | null> => {
      if (!shouldConfirmMileageBeforeClose(candidate, { clientVehicles })) {
        return Promise.resolve(candidate);
      }
      setOrder(candidate);
      setOpen(true);
      return new Promise<Order | null>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [clientVehicles],
  );

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next && !saving) closeDialog(null);
    },
    [closeDialog, saving],
  );

  const onConfirm = useCallback(
    async (result: ConfirmOrderMileageResult) => {
      const current = order;
      if (!current) {
        closeDialog(null);
        return;
      }
      if (result.action === "skip") {
        closeDialog(current);
        return;
      }
      if (saving) return;
      setSaving(true);
      try {
        const updated = await updateOrderFields(
          current.id,
          {
            vehicleMileageSnapshot: result.mileage,
            vehicleMileageUnitSnapshot: result.unit,
            vehicleMileageConfirmed: true,
          },
          workspaceId,
        );
        void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
        closeDialog(updated);
      } catch {
        // Keep the dialog open: closing now would activate warranties from the old
        // intake mileage. The user can retry or explicitly close without changes.
        toast.error(t("orders.lifecycle.confirmMileageSaveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [closeDialog, order, queryClient, saving, t, workspaceId],
  );

  return {
    ensureConfirmed,
    dialogProps: {
      open,
      order,
      vehicle: vehicle as Vehicle | null | undefined,
      onOpenChange,
      onConfirm,
      saving,
    },
  };
}
