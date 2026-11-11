import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Car, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { Order, Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Skeleton } from "../../ui/Skeleton";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import { highlightMatch } from "../clients/clientSearch";
import { formatVehicleMileage } from "./vehicleMileage";
import { filterClientVehiclesByQuery } from "./clientVehicleSearch";
import { useGetClientVehicles } from "./useGetClientVehicles";
import { useArchiveVehicle, useCreateVehicle, useUpdateVehicle } from "./useVehicleMutations";
import { VehicleDetailPanel } from "./VehicleDetailPanel";
import { VehicleFormDialog } from "./VehicleFormDialog";

type ClientVehiclesSectionProps = {
  clientId: string;
  /** Reuse the parent Client Details → Order Details flow when present. */
  onOpenOrder?: (orderId: string) => void;
  /**
   * Opens the existing create-order flow for this client with the clicked vehicle
   * preselected (`orders.vehicle_id`).
   */
  onCreateOrder?: (vehicleId: string) => void;
  /** When set, only these vehicle ids are shown (client-card search). */
  visibleVehicleIds?: string[];
  /** Lowercased query for match highlighting. */
  highlightQuery?: string;
};

export function ClientVehiclesSection({
  clientId,
  onOpenOrder,
  onCreateOrder,
  visibleVehicleIds,
  highlightQuery = "",
}: ClientVehiclesSectionProps) {
  const { t } = useTranslation();
  const { vehicles: allVehicles, isLoading, isError } = useGetClientVehicles(clientId);
  const baseVehicles =
    visibleVehicleIds == null
      ? allVehicles
      : allVehicles.filter((vehicle) => visibleVehicleIds.includes(vehicle.id));
  const createVehicle = useCreateVehicle(clientId);
  const updateVehicle = useUpdateVehicle(clientId);
  const archiveVehicle = useArchiveVehicle(clientId);

  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Vehicle | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [vehicleOpen, setVehicleOpen] = useState(false);

  useEffect(() => {
    setSearchQuery("");
  }, [clientId]);

  const vehicles = filterClientVehiclesByQuery(baseVehicles, searchQuery);
  const searchActive = searchQuery.trim().length > 0;
  const effectiveHighlight = searchActive ? searchQuery.trim().toLowerCase() : highlightQuery;
  const showSearch = !isLoading && !isError && allVehicles.length > 0;

  function openVehicle(vehicleId: string) {
    setSelectedVehicleId(vehicleId);
    setVehicleOpen(true);
  }

  function handleOpenOrder(order: Order) {
    setVehicleOpen(false);
    onOpenOrder?.(order.id);
  }

  function handleOpenClient(ownerClientId: string) {
    // Client Details for this owner is already open underneath — only dismiss the vehicle drawer.
    if (ownerClientId === clientId) {
      setVehicleOpen(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {/* Total active vehicles for this client (not the search-filtered subset). */}
          {t("vehicles.sectionTitleWithCount", { count: allVehicles.length })}
        </h3>
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

      {showSearch ? (
        <div className="relative w-full sm:max-w-xs lg:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("vehicles.searchPlaceholder")}
            aria-label={t("vehicles.searchPlaceholder").replace(/\.+$/, "")}
            className="h-9 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={t("common.clearSearch")}
              className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t("vehicles.loadFailed")}</p>
      ) : baseVehicles.length === 0 ? (
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
      ) : vehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <Car className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{t("vehicles.noMatch")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <button
                type="button"
                onClick={() => openVehicle(vehicle.id)}
                className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <p className="text-sm font-medium text-primary [overflow-wrap:anywhere] hover:underline">
                  {effectiveHighlight ? (
                    <span
                      dangerouslySetInnerHTML={{
                        __html: highlightMatch(vehicleDisplayLabel(vehicle), effectiveHighlight),
                      }}
                    />
                  ) : (
                    vehicleDisplayLabel(vehicle)
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {effectiveHighlight ? (
                    <span
                      dangerouslySetInnerHTML={{
                        __html: highlightMatch(
                          [
                            vehicle.make ? `${t("vehicles.fields.make")}: ${vehicle.make}` : null,
                            vehicle.model ? `${t("vehicles.fields.model")}: ${vehicle.model}` : null,
                            vehicle.year != null ? `${t("vehicles.fields.year")}: ${vehicle.year}` : null,
                            vehicle.vin ? `${t("vehicles.fields.vin")}: ${vehicle.vin}` : null,
                            vehicle.licensePlate
                              ? `${t("vehicles.fields.licensePlate")}: ${vehicle.licensePlate}`
                              : null,
                            vehicle.currentMileage != null
                              ? `${t("vehicles.fields.currentMileage")}: ${formatVehicleMileage(vehicle.currentMileage, vehicle.mileageUnit, t)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          effectiveHighlight,
                        ),
                      }}
                    />
                  ) : (
                    [
                      vehicle.make ? `${t("vehicles.fields.make")}: ${vehicle.make}` : null,
                      vehicle.model ? `${t("vehicles.fields.model")}: ${vehicle.model}` : null,
                      vehicle.year != null ? `${t("vehicles.fields.year")}: ${vehicle.year}` : null,
                      vehicle.vin ? `${t("vehicles.fields.vin")}: ${vehicle.vin}` : null,
                      vehicle.licensePlate
                        ? `${t("vehicles.fields.licensePlate")}: ${vehicle.licensePlate}`
                        : null,
                      vehicle.currentMileage != null
                        ? `${t("vehicles.fields.currentMileage")}: ${formatVehicleMileage(vehicle.currentMileage, vehicle.mileageUnit, t)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  )}
                </p>
              </button>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                {onCreateOrder ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={t("vehicles.createOrderFor", { name: vehicleDisplayLabel(vehicle) })}
                    onClick={() => onCreateOrder(vehicle.id)}
                  >
                    <Plus className="size-4" />
                    {t("vehicles.createOrder")}
                  </Button>
                ) : null}
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

      <VehicleDetailPanel
        vehicleId={selectedVehicleId}
        open={vehicleOpen}
        onOpenChange={setVehicleOpen}
        onOpenClient={handleOpenClient}
        onOpenOrder={onOpenOrder ? handleOpenOrder : undefined}
      />
    </section>
  );
}
