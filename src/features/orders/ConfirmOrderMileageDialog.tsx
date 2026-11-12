import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MileageUnit, Order, Vehicle } from "../../lib/types";
import { formatMileageInput } from "../../lib/mileage";
import { currentIntlLocale } from "../../i18n";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { MileageInput } from "../../ui/MileageInput";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import {
  parseVisitMileage,
  resolveCloseMileagePrefill,
  visitMileageValidate,
} from "./orderVehicleMileage";

export type ConfirmOrderMileageResult =
  | { action: "save"; mileage: number | null; unit: MileageUnit | null }
  | { action: "skip" };

type ConfirmOrderMileageDialogProps = {
  open: boolean;
  order: Order | null;
  vehicle: Vehicle | null | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ConfirmOrderMileageResult) => void;
  saving?: boolean;
};

/**
 * Soft warning before close when mileage warranties exist and intake was not confirmed.
 * Never blocks closing — both primary actions proceed.
 */
export function ConfirmOrderMileageDialog({
  open,
  order,
  vehicle,
  onOpenChange,
  onConfirm,
  saving = false,
}: ConfirmOrderMileageDialogProps) {
  const { t } = useTranslation();
  const prefill = useMemo(
    () =>
      order
        ? resolveCloseMileagePrefill({ order, vehicle })
        : { value: null as number | null, unit: null as MileageUnit | null },
    [order, vehicle],
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      prefill.value != null ? formatMileageInput(prefill.value, currentIntlLocale()) : "",
    );
  }, [open, prefill.value]);

  if (!order) return null;

  const unitAbbr = mileageUnitAbbreviation(prefill.unit, t);
  const hasKnown = prefill.value != null;
  const description = hasKnown
    ? t("orders.lifecycle.confirmMileageDescription", {
        value: formatMileageInput(prefill.value!, currentIntlLocale()),
        unit: unitAbbr || t("vehicles.mileage.unitUnknownShort"),
      })
    : t("orders.lifecycle.confirmMileageMissingDescription");

  function handleSaveAndClose() {
    const validation = visitMileageValidate(draft);
    if (validation !== true) {
      setError(typeof validation === "string" ? validation : t("vehicles.validation.mileageInvalid"));
      return;
    }
    let mileage: number | null = null;
    try {
      mileage = parseVisitMileage(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vehicles.validation.mileageInvalid"));
      return;
    }
    onConfirm({
      action: "save",
      mileage,
      unit: prefill.unit ?? vehicle?.mileageUnit ?? null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onClick={(event) => event.stopPropagation()}
        data-testid="confirm-order-mileage-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("orders.lifecycle.confirmMileageTitle")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-order-mileage-input">
            {t("vehicles.fields.intakeMileage")}
            {unitAbbr ? (
              <span className="ml-1 font-normal text-muted-foreground">({unitAbbr})</span>
            ) : null}
          </Label>
          <MileageInput
            id="confirm-order-mileage-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            unitSuffix={unitAbbr || undefined}
            placeholder={t("vehicles.placeholders.intakeMileage")}
            data-testid="confirm-order-mileage-input"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="w-full"
            onClick={handleSaveAndClose}
            disabled={saving}
            data-testid="confirm-order-mileage-save"
          >
            {t("orders.lifecycle.confirmMileageSaveAndClose")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onConfirm({ action: "skip" })}
            disabled={saving}
            data-testid="confirm-order-mileage-skip"
          >
            {t("orders.lifecycle.confirmMileageCloseWithoutChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
