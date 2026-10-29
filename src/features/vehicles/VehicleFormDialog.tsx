import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Vehicle, VehicleInput } from "../../lib/types";
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
};

export function VehicleFormDialog({ open, onOpenChange, title, description, initial, submitting, onSubmit }: VehicleFormDialogProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VehicleFormValues>({
    defaultValues: vehicleToFormValues(initial),
  });

  useEffect(() => {
    if (open) reset(vehicleToFormValues(initial));
  }, [open, initial, reset]);

  const busy = Boolean(submitting || isSubmitting);

  async function submit(values: VehicleFormValues) {
    await onSubmit(vehicleFormValuesToInput(values));
    onOpenChange(false);
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
          <VehicleFields register={register} setValue={setValue} watch={watch} errors={errors} disabled={busy} />

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
