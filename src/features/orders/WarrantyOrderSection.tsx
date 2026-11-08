import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import {
  clearWarrantyOrderLink,
  evaluateSnapshotAgainstVehicle,
  filterEligibleWarrantySourceOrders,
  getWarrantyClaimsForOrder,
  getWarrantyRecordsForOrder,
  saveWarrantyOrderLink,
  type WarrantyClaimInput,
} from "../../services/apiWarranty";
import { isWarrantyExpired, isWarrantySourceFormallyClosed, snapshotMileageUnit } from "./warranty";
import { formatVehicleMileage } from "../vehicles/vehicleMileage";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetOrders } from "./useGetOrders";
import { formatWarrantyEndsOn } from "./OrderWarrantyIndicator";

type Props = {
  order: Order;
  currentMileage: number | null;
  disabled?: boolean;
  onChanged?: () => void;
};

export default function WarrantyOrderSection({ order, currentMileage, disabled, onChanged }: Props) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { orders } = useGetOrders();
  const [enabled, setEnabled] = useState(Boolean(order.warrantySourceOrderId));
  const [sourceOrderId, setSourceOrderId] = useState(order.warrantySourceOrderId ?? "");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [acceptExpired, setAcceptExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(Boolean(order.warrantySourceOrderId));
    setSourceOrderId(order.warrantySourceOrderId ?? "");
  }, [order.warrantySourceOrderId, order.id]);

  const eligible = useMemo(
    () =>
      filterEligibleWarrantySourceOrders({
        candidates: orders ?? [],
        clientId: order.clientId,
        vehicleId: order.vehicleId,
        excludeOrderId: order.id,
      }),
    [orders, order.clientId, order.vehicleId, order.id],
  );

  const sourceOrder = eligible.find((row) => row.id === sourceOrderId) ?? (orders ?? []).find((row: Order) => row.id === sourceOrderId);

  const recordsQuery = useQuery({
    queryKey: ["warranty-records", workspaceId, sourceOrderId],
    queryFn: () => getWarrantyRecordsForOrder(workspaceId, sourceOrderId),
    enabled: Boolean(workspaceId && enabled && sourceOrderId),
  });

  const claimsQuery = useQuery({
    queryKey: ["warranty-claims", workspaceId, order.id],
    queryFn: () => getWarrantyClaimsForOrder(workspaceId, order.id),
    enabled: Boolean(workspaceId && order.warrantySourceOrderId),
  });

  useEffect(() => {
    if (claimsQuery.data?.length) {
      setSelectedRecordIds(claimsQuery.data.map((claim) => claim.warrantyRecordId));
      setAcceptExpired(claimsQuery.data.some((claim) => claim.acceptedOutsidePeriod));
    }
  }, [claimsQuery.data]);

  const orderMileageUnit = order.vehicleMileageUnitSnapshot ?? "km";
  const sourceClosed = sourceOrder ? isWarrantySourceFormallyClosed(sourceOrder) : false;
  const evaluations = useMemo(() => {
    return (recordsQuery.data ?? []).map((snapshot) => ({
      snapshot,
      evaluation: evaluateSnapshotAgainstVehicle(
        snapshot,
        currentMileage,
        undefined,
        orderMileageUnit,
        sourceOrder ? sourceClosed : undefined,
      ),
    }));
  }, [recordsQuery.data, currentMileage, orderMileageUnit, sourceOrder, sourceClosed]);

  useEffect(() => {
    const pausedIds = new Set(
      evaluations.filter(({ evaluation }) => evaluation.status === "paused").map(({ snapshot }) => snapshot.id),
    );
    if (pausedIds.size === 0) return;
    setSelectedRecordIds((prev) => {
      const next = prev.filter((id) => !pausedIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [evaluations]);

  async function persist(nextEnabled: boolean, nextSourceId: string, nextRecordIds: string[], nextAcceptExpired: boolean) {
    if (!workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      if (!nextEnabled) {
        await clearWarrantyOrderLink(workspaceId, order.id);
        onChanged?.();
        return;
      }
      const source = eligible.find((row) => row.id === nextSourceId) ?? sourceOrder;
      if (!source) throw new Error(t("orders.warranty.errors.selectOriginal"));
      const claims: WarrantyClaimInput[] = nextRecordIds.map((recordId) => {
        const snapshot = (recordsQuery.data ?? []).find((row) => row.id === recordId);
        const evaluation = snapshot
          ? evaluateSnapshotAgainstVehicle(snapshot, currentMileage, undefined, orderMileageUnit)
          : null;
        return {
          warrantyRecordId: recordId,
          acceptedOutsidePeriod: Boolean(evaluation && isWarrantyExpired(evaluation.status) && nextAcceptExpired),
          currentMileageAtClaim: currentMileage,
        };
      });
      await saveWarrantyOrderLink({
        workspaceId,
        warrantyOrderId: order.id,
        sourceOrder: source,
        warrantyOrder: order,
        claims,
        currentMileage,
      });
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label={t("orders.warranty.sectionLabel")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("orders.warranty.switchLabel")}</p>
          <p className="text-xs text-muted-foreground">{t("orders.warranty.switchHint")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled || saving}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            if (!checked) {
              setSourceOrderId("");
              setSelectedRecordIds([]);
              void persist(false, "", [], false);
            }
          }}
          aria-label={t("orders.warranty.switchLabel")}
        />
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`warranty-source-${order.id}`}>{t("orders.warranty.originalOrder")}</Label>
            <select
              id={`warranty-source-${order.id}`}
              className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
              disabled={disabled || saving}
              value={sourceOrderId}
              onChange={(event) => {
                setSourceOrderId(event.target.value);
                setSelectedRecordIds([]);
                setAcceptExpired(false);
              }}
            >
              <option value="">{t("orders.warranty.selectOriginal")}</option>
              {eligible.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.orderNumber}
                  {row.closedAt ? ` · ${row.closedAt.slice(0, 10)}` : ""}
                </option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("orders.warranty.noEligibleOriginals")}</p>
            )}
          </div>

          {sourceOrder && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {t("orders.warranty.closedAt")}: {sourceOrder.closedAt?.slice(0, 10) || "—"}
              </p>
              <p>
                {t("orders.warranty.startMileage")}:{" "}
                {sourceOrder.vehicleMileageSnapshot != null
                  ? formatVehicleMileage(
                      sourceOrder.vehicleMileageSnapshot,
                      sourceOrder.vehicleMileageUnitSnapshot ?? "km",
                      t,
                    )
                  : "—"}
              </p>
            </div>
          )}

          {evaluations.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("orders.warranty.coveredItems")}</p>
              {evaluations.map(({ snapshot, evaluation }) => {
                const checked = selectedRecordIds.includes(snapshot.id);
                const expired = isWarrantyExpired(evaluation.status);
                const paused = evaluation.status === "paused";
                const startDateLabel = formatWarrantyEndsOn(snapshot.startsAt?.slice(0, 10) ?? null);
                return (
                  <label
                    key={snapshot.id}
                    className={`flex items-start gap-2 rounded-md border p-2 text-sm ${paused ? "opacity-70" : ""}`}
                    data-warranty-claim-option
                    data-warranty-status={evaluation.status}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked && !paused}
                      disabled={disabled || saving || paused}
                      onChange={(event) => {
                        if (paused) return;
                        setSelectedRecordIds((prev) =>
                          event.target.checked ? [...prev, snapshot.id] : prev.filter((id) => id !== snapshot.id),
                        );
                      }}
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block font-medium">{snapshot.itemName}</span>
                      <span
                        className={`block text-xs ${paused ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                      >
                        {paused
                          ? startDateLabel
                            ? t("orders.warranty.pausedSinceClose", { date: startDateLabel })
                            : t("orders.warranty.status.paused")
                          : [
                              t(`orders.warranty.status.${evaluation.status}`),
                              evaluation.expiresOn
                                ? `${t("orders.warranty.expiresOn")}: ${evaluation.expiresOn}`
                                : null,
                              evaluation.expiresAtMileage != null
                                ? `${t("orders.warranty.expiresAtMileage")}: ${formatVehicleMileage(evaluation.expiresAtMileage, snapshotMileageUnit(snapshot), t)}`
                                : null,
                              evaluation.remainingMileage != null
                                ? `${t("orders.warranty.remainingMileage")}: ${formatVehicleMileage(evaluation.remainingMileage, snapshotMileageUnit(snapshot), t)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </span>
                      {paused ? (
                        <span className="block text-xs text-amber-700 dark:text-amber-400">
                          {t("orders.warranty.errors.pausedSourceNotClosed")}
                        </span>
                      ) : null}
                      {expired && checked && (
                        <span className="block text-xs text-destructive">{t("orders.warranty.expiredWarning")}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {evaluations.some(({ snapshot, evaluation }) => selectedRecordIds.includes(snapshot.id) && isWarrantyExpired(evaluation.status)) && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptExpired}
                disabled={disabled || saving}
                onChange={(event) => setAcceptExpired(event.target.checked)}
              />
              <span>{t("orders.warranty.acceptExpired")}</span>
            </label>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={disabled || saving || !sourceOrderId}
            onClick={() => void persist(true, sourceOrderId, selectedRecordIds, acceptExpired)}
          >
            {saving ? t("orders.warranty.saving") : t("orders.warranty.saveLink")}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
