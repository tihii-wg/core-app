import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { VinOwnerMatch } from "../../services/apiVehicles";
import { useVinOwner, vinOwnerVehicleLabel } from "./vinOwner";

export type VinOwnerCheckOptions = {
  /** Vehicle being edited (its own VIN is not a duplicate). */
  excludeVehicleId?: string | null;
  /** Client the vehicle is for; null while the client is still being created. */
  currentClientId?: string | null;
  /** Offer «move this car to the client» (change of owner). */
  onTransfer?: (match: VinOwnerMatch) => void;
  transferLabel?: string;
  transferPending?: boolean;
  /** Transfer already chosen (applied on save). */
  transferSelected?: boolean;
  onCancelTransfer?: () => void;
};

/** Under the VIN input: tells which client already has this VIN and offers the change of owner. */
export function VinOwnerNotice({ vin, options, disabled }: { vin: string; options: VinOwnerCheckOptions; disabled?: boolean }) {
  const { t } = useTranslation();
  const { match, checking } = useVinOwner(vin, options.excludeVehicleId);

  if (checking && !match) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="vin-owner-checking">
        <Spinner className="size-3" />
        {t("vehicles.vinOwner.checking")}
      </p>
    );
  }
  if (!match) return null;

  const sameClient = Boolean(options.currentClientId) && match.clientId === options.currentClientId;
  const vehicleLabel = vinOwnerVehicleLabel(match);
  const owner = match.clientName || t("vehicles.vinOwner.unnamedClient");

  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="status" data-testid="vin-owner-notice">
      <p className="flex items-start gap-2 font-medium text-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {t("vehicles.vinOwner.foundTitle")}
      </p>
      <div className="space-y-0.5 pl-6 text-[13px] text-muted-foreground">
        <p>
          {t("vehicles.vinOwner.foundOwner", { client: owner })}
          {match.clientPhone ? <span className="tabular-nums"> · {match.clientPhone}</span> : null}
          {match.clientDeleted ? <span> · {t("vehicles.vinOwner.ownerDeleted")}</span> : null}
        </p>
        {vehicleLabel ? <p>{t("vehicles.vinOwner.foundVehicle", { vehicle: vehicleLabel })}</p> : null}
        {!sameClient && match.ordersCount > 0 && (options.onTransfer || options.transferSelected) ? (
          <p className="text-foreground">{t("vehicles.vinOwner.ordersMove", { count: match.ordersCount })}</p>
        ) : null}
      </div>
      {sameClient ? (
        <p className="pl-6 text-[13px] text-foreground">{t("vehicles.vinOwner.sameClient")}</p>
      ) : options.transferSelected ? (
        <div className="space-y-2 pl-6">
          <p className="text-[13px] text-foreground">{t("vehicles.vinOwner.transferSelected")}</p>
          {options.onCancelTransfer ? (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={options.onCancelTransfer}>
              {t("vehicles.vinOwner.cancelTransfer")}
            </Button>
          ) : null}
        </div>
      ) : options.onTransfer ? (
        <div className="space-y-1.5 pl-6">
          <Button
            type="button"
            size="sm"
            disabled={disabled || options.transferPending}
            onClick={() => options.onTransfer?.(match)}
          >
            {options.transferPending ? <Spinner className="size-3.5" /> : <ArrowRightLeft className="size-3.5" />}
            {options.transferLabel ?? t("vehicles.vinOwner.transfer")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("vehicles.vinOwner.transferHint")}</p>
          <p className="text-xs text-muted-foreground">{t("vehicles.vinOwner.plateHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
