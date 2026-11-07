import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { MileageUnit } from "../../lib/types";
import { mileageUnitAbbreviation, resolveFormOrderMileageUnit } from "../vehicles/vehicleMileage";
import { convertOrderLineWarrantyKm } from "./catalogWarranty";

type LineMileage = { warrantyKm?: number | null };

type SyncHandlers = {
  getServices: () => LineMileage[];
  getMaterials: () => LineMileage[];
  setServiceWarrantyKm: (index: number, warrantyKm: number | null) => void;
  setMaterialWarrantyKm: (index: number, warrantyKm: number | null) => void;
};

/**
 * Tracks the live order form mileage unit (selected vehicle, else snapshot).
 * When the unit changes, converts in-form line warranty_km values and toasts.
 */
export function useOrderMileageUnitSync(params: {
  vehicleUnit: MileageUnit | null | undefined;
  snapshotUnit?: MileageUnit | null;
  handlers: SyncHandlers;
  enabled?: boolean;
}): MileageUnit {
  const { t } = useTranslation();
  const orderUnit = resolveFormOrderMileageUnit({
    vehicleUnit: params.vehicleUnit,
    snapshotUnit: params.snapshotUnit,
  });
  const previousUnitRef = useRef<MileageUnit | null>(null);
  const handlersRef = useRef(params.handlers);
  handlersRef.current = params.handlers;
  const enabled = params.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      previousUnitRef.current = orderUnit;
      return;
    }
    const previous = previousUnitRef.current;
    previousUnitRef.current = orderUnit;
    if (previous == null || previous === orderUnit) return;

    const handlers = handlersRef.current;
    let changed = false;

    handlers.getServices().forEach((line, index) => {
      if (line.warrantyKm == null) return;
      const next = convertOrderLineWarrantyKm(line.warrantyKm, previous, orderUnit);
      if (next != null && next !== line.warrantyKm) {
        handlers.setServiceWarrantyKm(index, next);
        changed = true;
      }
    });
    handlers.getMaterials().forEach((line, index) => {
      if (line.warrantyKm == null) return;
      const next = convertOrderLineWarrantyKm(line.warrantyKm, previous, orderUnit);
      if (next != null && next !== line.warrantyKm) {
        handlers.setMaterialWarrantyKm(index, next);
        changed = true;
      }
    });

    if (changed) {
      toast(t("orders.warranty.mileageUnitRecalculated", { unit: mileageUnitAbbreviation(orderUnit, t) }), {
        id: "order-warranty-mileage-unit",
      });
    }
  }, [enabled, orderUnit, t]);

  return orderUnit;
}
