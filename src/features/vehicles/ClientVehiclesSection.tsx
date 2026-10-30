import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Car, Pencil, Plus, Trash2 } from "lucide-react";
import type { Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Skeleton } from "../../ui/Skeleton";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import { vehicleDetailsPath } from "./vehicleRoutes";
import { useGetClientVehicles } from "./useGetClientVehicles";
import { useArchiveVehicle, useCreateVehicle, useUpdateVehicle } from "./useVehicleMutations";
import { VehicleFormDialog } from "./VehicleFormDialog";

type ClientVehiclesSectionProps = {
  clientId: string;
};

export function ClientVehiclesSection({ clientId }: ClientVehiclesSectionProps) {
  const { t } = useTranslation();
  const { locale = "en", workspaceId = "" } = useParams();
  const { vehicles, isLoading, isError } = useGetClientVehicles(clientId);
  const createVehicle = useCreateVehicle(clientId);
  const updateVehicle = useUpdateVehicle(clientId);
  const archiveVehicle = useArchiveVehicle(clientId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Vehicle | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t("vehicles.sectionTitle")}</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t("vehicles.add")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t("vehicles.loadFailed")}</p>
      ) : vehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <Car className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{t("vehicles.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("vehicles.emptyDescription")}</p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("vehicles.add")}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <Link
                to={vehicleDetailsPath(locale, workspaceId, vehicle.id)}
                className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <p className="text-sm font-medium text-primary [overflow-wrap:anywhere] hover:underline">
                  {vehicleDisplayLabel(vehicle)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {[
                    vehicle.make ? `${t("vehicles.fields.make")}: ${vehicle.make}` : null,
                    vehicle.model ? `${t("vehicles.fields.model")}: ${vehicle.model}` : null,
                    vehicle.year != null ? `${t("vehicles.fields.year")}: ${vehicle.year}` : null,
                    vehicle.vin ? `${t("vehicles.fields.vin")}: ${vehicle.vin}` : null,
                    vehicle.licensePlate ? `${t("vehicles.fields.licensePlate")}: ${vehicle.licensePlate}` : null,
                    vehicle.currentMileage != null
                      ? `${t("vehicles.fields.currentMileage")}: ${vehicle.currentMileage}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("vehicles.edit")}
                  onClick={() => {
                    setEditing(vehicle);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("vehicles.archive")}
                  onClick={() => setArchiveTarget(vehicle)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <VehicleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? t("vehicles.editTitle") : t("vehicles.addTitle")}
        description={editing ? t("vehicles.editDescription") : t("vehicles.addDescription")}
        initial={editing}
        submitting={createVehicle.isPending || updateVehicle.isPending}
        onSubmit={async (input) => {
          if (editing) {
            await updateVehicle.mutateAsync({ vehicleId: editing.id, input });
          } else {
            await createVehicle.mutateAsync(input);
          }
        }}
      />

      <Dialog open={archiveTarget != null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("vehicles.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("vehicles.archiveDescription", {
                name: archiveTarget ? vehicleDisplayLabel(archiveTarget) : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveTarget(null)} disabled={archiveVehicle.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={archiveVehicle.isPending}
              onClick={() => {
                if (!archiveTarget) return;
                void archiveVehicle.mutateAsync(archiveTarget.id).then(() => setArchiveTarget(null));
              }}
            >
              {archiveVehicle.isPending ? t("common.deleting") : t("vehicles.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
