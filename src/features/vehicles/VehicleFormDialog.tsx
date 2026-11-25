import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Vehicle, VehicleInput } from "../../lib/types";
import { probeVehicleMileageUnitSupport, type VinOwnerMatch } from "../../services/apiVehicles";
import { normalizeVin } from "../../lib/vin";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { fetchVinOwner } from "./vinOwner";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Spinner } from "../../ui/Spinner";
import { VehicleFields } from "./VehicleFields";
import { vehicleFormValuesToInput, vehicleToFormValues, type VehicleFormValues } from "./vehicleForm";

type VehicleFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initial?: Vehicle | null;
  submitting?: boolean;
  onSubmit: (input: VehicleInput) => Promise<void>;
  /** Defaults to create when `initial` is absent, edit when present. */
  mode?: "create" | "edit";
  /** Client the vehicle belongs to — enables «this VIN is already on another client» + change of owner. */
  clientId?: string | null;
  /** Create mode: move the existing vehicle with this VIN to `clientId` instead of creating a duplicate. */
  onTransferExisting?: (match: VinOwnerMatch, licensePlate: string | null) => Promise<void>;
};

export function VehicleFormDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  submitting,
  onSubmit,
  mode,
  clientId,
  onTransferExisting,
}: VehicleFormDialogProps) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const [transferring, setTransferring] = useState(false);
  const fieldsMode = mode ?? (initial ? "edit" : "create");
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VehicleFormValues>({
    defaultValues: vehicleToFormValues(initial),
  });

  useEffect(() => {
    if (open) reset(vehicleToFormValues(initial));
  }, [open, initial, reset]);

  // Refresh mileage_unit column support when the dialog opens so a stale
  // "missing column" cache cannot block select/save after SQL was applied.
  useEffect(() => {
    if (!open) return;
    void probeVehicleMileageUnitSupport();
  }, [open]);

  const busy = Boolean(submitting || isSubmitting || transferring);

  async function submit(values: VehicleFormValues) {
    // One VIN = one vehicle. In edit mode only a changed VIN is checked (old duplicates stay editable).
    const vinChanged = fieldsMode === "create" || normalizeVin(values.vin) !== normalizeVin(initial?.vin);
    if (vinChanged) {
      const match = await fetchVinOwner(queryClient, workspaceId, values.vin, initial?.id ?? null);
      if (match) {
        setError("vin", { type: "duplicate", message: t("vehicles.vinOwner.blockedSave") });
        return;
      }
    }
    await onSubmit(vehicleFormValuesToInput(values));
    onOpenChange(false);
  }

  async function transfer(match: VinOwnerMatch) {
    if (!onTransferExisting || transferring) return;
    setTransferring(true);
    try {
      // A plate typed in the form = the new owner's plate (optional).
      await onTransferExisting(match, getValues("licensePlate")?.trim() || null);
      onOpenChange(false);
    } catch {
      // The mutation hook toasts the error.
    } finally {
      setTransferring(false);
    }
  }

  // Avoid a nested <form> inside order/client forms: even portaled dialogs bubble
  // submit through the React tree and can reset/submit the parent RHF form.
  const save = handleSubmit(async (values) => {
    try {
      await submit(values);
    } catch {
      // Mutation hooks toast API errors; RHF shows field validation.
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          className="space-y-4"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            const target = event.target as HTMLElement | null;
            if (target?.tagName === "TEXTAREA") return;
            event.preventDefault();
            event.stopPropagation();
            if (!busy) void save();
          }}
        >
          <VehicleFields
            register={register}
            setValue={setValue}
            watch={watch}
            errors={errors}
            disabled={busy}
            mode={fieldsMode}
            vinCheck={{
              excludeVehicleId: initial?.id ?? null,
              currentClientId: clientId ?? initial?.clientId ?? null,
              onTransfer: fieldsMode === "create" && clientId && onTransferExisting ? (match) => void transfer(match) : undefined,
              transferPending: transferring,
            }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void save();
              }}
            >
              {busy ? <Spinner className="size-4" /> : t("common.save")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
