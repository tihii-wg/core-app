import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Skeleton } from "../../ui/Skeleton";
import { Spinner } from "../../ui/Spinner";
import { cn } from "../../lib/utils";
import type { Vehicle } from "../../lib/types";
import { useConfirm } from "../../ui/ConfirmProvider";
import { getOrderCountsByVehicle, mergeVehicles, vehicleDisplayLabel } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { filterClientVehiclesByQuery } from "./clientVehicleSearch";
import { clientVehiclesQueryKey } from "./useGetClientVehicles";
import { vehicleQueryKey } from "./useGetVehicle";

type MergeVehiclesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Active vehicles of this client. */
  vehicles: Vehicle[];
  /** Search text from the vehicles list — the dialog starts with it. */
  initialSearch?: string;
};

/**
 * Merge duplicate vehicles of one client (same car entered several times): find them by VIN / plate / make,
 * tick them, pick the one to keep — orders, warranties and mileage history of the others move to it.
 */
export function MergeVehiclesDialog({ open, onOpenChange, clientId, vehicles, initialSearch = "" }: MergeVehiclesDialogProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const [search, setSearch] = useState(initialSearch);
  const [selected, setSelected] = useState<string[]>([]);
  const [mainId, setMainId] = useState<string>("");

  // Reset each time the dialog opens (state, not an effect: no extra render pass).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSearch(initialSearch);
      setSelected([]);
      setMainId("");
    }
  }

  const vehicleIds = useMemo(() => vehicles.map((vehicle) => vehicle.id), [vehicles]);
  const countsQuery = useQuery({
    queryKey: ["vehicle-order-counts", workspaceId, clientId, vehicleIds.join(",")],
    queryFn: () => getOrderCountsByVehicle(workspaceId, vehicleIds),
    enabled: open && Boolean(workspaceId) && vehicleIds.length > 1,
    staleTime: 30_000,
  });
  const counts = countsQuery.data;

  const found = filterClientVehiclesByQuery(vehicles, search);
  const selectedSet = new Set(selected);
  const selectedVehicles = vehicles.filter((vehicle) => selectedSet.has(vehicle.id));
  // Kept vehicle: the user's pick, else the one with most orders (then the oldest).
  const defaultMain = [...selectedVehicles].sort(
    (a, b) => (counts?.get(b.id) ?? 0) - (counts?.get(a.id) ?? 0) || a.createdAt.localeCompare(b.createdAt),
  )[0];
  const main = selectedVehicles.find((vehicle) => vehicle.id === mainId) ?? defaultMain;

  const merge = useMutation({
    mutationFn: () => {
      guardWrite();
      if (!main) throw new Error(t("vehicles.merge.pickTwo"));
      return mergeVehicles(
        workspaceId,
        main.id,
        selectedVehicles.filter((vehicle) => vehicle.id !== main.id).map((vehicle) => vehicle.id),
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(clientVehiclesQueryKey(workspaceId, clientId), (previous: Vehicle[] | undefined) =>
        previous
          ? previous
              .filter((vehicle) => vehicle.id === result.vehicle.id || !selectedSet.has(vehicle.id))
              .map((vehicle) => (vehicle.id === result.vehicle.id ? result.vehicle : vehicle))
          : previous,
      );
      queryClient.setQueryData(vehicleQueryKey(workspaceId, result.vehicle.id), result.vehicle);
      void queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-vin-owner", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-order-counts", workspaceId] });
      if (result.movedOrders > 0) void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(t("vehicles.merge.done", { count: result.merged, orders: result.movedOrders }));
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || t("common.somethingWentWrong")),
  });

  function toggle(id: string, checked: boolean) {
    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
    if (!checked && mainId === id) setMainId("");
  }

  async function runMerge() {
    if (!main || selectedVehicles.length < 2) return;
    const others = selectedVehicles.length - 1;
    const ordersMoving = selectedVehicles
      .filter((vehicle) => vehicle.id !== main.id)
      .reduce((sum, vehicle) => sum + (counts?.get(vehicle.id) ?? 0), 0);
    const ok = await confirm({
      title: t("vehicles.merge.confirmTitle"),
      description: t("vehicles.merge.confirmDescription", {
        count: others,
        main: vehicleDisplayLabel(main),
        orders: ordersMoving,
      }),
      confirmLabel: t("vehicles.merge.submit"),
      tone: "destructive",
    });
    if (ok) merge.mutate();
  }

  const busy = merge.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("vehicles.merge.title")}</DialogTitle>
          <DialogDescription>{t("vehicles.merge.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("vehicles.merge.searchPlaceholder")}
            aria-label={t("vehicles.merge.searchPlaceholder")}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || found.length === 0}
              onClick={() => setSelected((current) => [...new Set([...current, ...found.map((vehicle) => vehicle.id)])])}
            >
              {t("vehicles.merge.selectAllFound", { count: found.length })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || selected.length === 0}
              onClick={() => {
                setSelected([]);
                setMainId("");
              }}
            >
              {t("vehicles.merge.clearSelection")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("vehicles.merge.selectedCount", { count: selected.length })}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="merge-vehicles-list">
          {found.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("vehicles.merge.nothingFound")}</p>
          ) : (
            found.map((vehicle) => {
              const checked = selectedSet.has(vehicle.id);
              const isMain = checked && main?.id === vehicle.id;
              const orderCount = counts?.get(vehicle.id);
              return (
                <div
                  key={vehicle.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-border p-3",
                    checked && "border-primary/50 bg-primary/5",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={checked}
                    disabled={busy}
                    aria-label={vehicleDisplayLabel(vehicle)}
                    onChange={(event) => toggle(vehicle.id, event.target.checked)}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{vehicleDisplayLabel(vehicle)}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {vehicle.vin ? `VIN ${vehicle.vin}` : t("vehicles.merge.noVin")}
                      {" · "}
                      {countsQuery.isLoading ? (
                        <Skeleton className="inline-block h-3 w-12 align-middle" />
                      ) : (
                        t("vehicles.merge.orders", { count: orderCount ?? 0 })
                      )}
                    </p>
                    {checked ? (
                      <label className="mt-1 flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="radio"
                          name="merge-vehicles-main"
                          className="accent-primary"
                          checked={isMain}
                          disabled={busy}
                          onChange={() => setMainId(vehicle.id)}
                        />
                        {isMain ? t("vehicles.merge.mainSelected") : t("vehicles.merge.makeMain")}
                      </label>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("vehicles.merge.hint")}</p>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={busy || selectedVehicles.length < 2} onClick={() => void runMerge()}>
            {busy ? <Spinner className="size-4" /> : null}
            {t("vehicles.merge.submitWithCount", { count: selectedVehicles.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
