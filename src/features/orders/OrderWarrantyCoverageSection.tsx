import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import { getWarrantyRecordsForOrder } from "../../services/apiWarranty";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import { formatWarrantyEndsOn, formatWarrantyKm, remainingDurationLabel } from "./OrderWarrantyIndicator";
import { OrderWarrantyPauseNotice } from "./OrderWarrantyPauseNotice";
import {
  buildOrderWarrantyIndicator,
  evaluateWarranty,
  hasWarrantyCoverage,
  isWarrantyExpired,
  isWarrantySourceFormallyClosed,
  snapshotMileageUnit,
  type WarrantySnapshot,
} from "./warranty";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";
import { cn } from "../../lib/utils";

type Props = {
  order: Order;
  currentMileage?: number | null;
};

/**
 * Read-only warranty coverage for an original order (not a warranty claim).
 * Prefers activated snapshots after close; falls back to configured line limits.
 * When the order is cancelled/reopened, existing snapshots show as paused.
 */
export function OrderWarrantyCoverageSection({ order, currentMileage }: Props) {
  const { t, i18n } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const isClaim = Boolean(order.warrantySourceOrderId);
  const sourceClosed = isWarrantySourceFormallyClosed(order);

  const recordsQuery = useQuery({
    queryKey: ["warranty-records", workspaceId, order.id],
    queryFn: () => getWarrantyRecordsForOrder(workspaceId, order.id),
    enabled: Boolean(workspaceId && !isClaim),
  });

  const snapshots = recordsQuery.data ?? [];
  const mileage = currentMileage ?? order.vehicleMileageSnapshot ?? null;
  const orderUnit = order.vehicleMileageUnitSnapshot ?? "km";

  const configuredLines = useMemo(() => {
    const services = (order.services ?? [])
      .filter((line) =>
        hasWarrantyCoverage({
          durationMonths: line.warrantyMonths ?? null,
          durationDays: line.warrantyDays ?? null,
          mileageLimit: line.warrantyKm ?? null,
        }),
      )
      .map((line) => ({
        key: line.id ?? `svc-${line.serviceId}`,
        name: line.serviceName,
        kind: "service" as const,
        limits: {
          durationMonths: line.warrantyMonths ?? null,
          durationDays: line.warrantyDays ?? null,
          mileageLimit: line.warrantyKm ?? null,
        },
      }));
    const materials = (order.materials ?? [])
      .filter((line) =>
        hasWarrantyCoverage({
          durationMonths: line.warrantyMonths ?? null,
          durationDays: line.warrantyDays ?? null,
          mileageLimit: line.warrantyKm ?? null,
        }),
      )
      .map((line) => ({
        key: line.id ?? `mat-${line.inventoryItemId ?? line.itemName}`,
        name: line.itemName,
        kind: "material" as const,
        limits: {
          durationMonths: line.warrantyMonths ?? null,
          durationDays: line.warrantyDays ?? null,
          mileageLimit: line.warrantyKm ?? null,
        },
      }));
    return [...services, ...materials];
  }, [order.services, order.materials]);

  if (isClaim) return null;

  const hasSnapshots = snapshots.length > 0;
  const lines = hasSnapshots
    ? snapshots.map((snapshot) => ({
        snapshot,
        evaluation: evaluateWarranty({
          snapshot,
          currentMileage: mileage,
          currentMileageUnit: orderUnit,
          sourceOrderClosed: sourceClosed,
        }),
      }))
    : [];

  if (!hasSnapshots && configuredLines.length === 0) return null;

  const summary = hasSnapshots
    ? buildOrderWarrantyIndicator({
        snapshots,
        currentMileage: mileage,
        currentMileageUnit: orderUnit,
        isWarrantyOrder: false,
        sourceOrderClosed: sourceClosed,
      })
    : null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4" data-warranty-coverage>
      <OrderWarrantyPauseNotice order={order} records={snapshots} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("orders.warranty.coverageTitle")}</h3>
        {summary?.visible ? (
          <span
            className={cn(
              "text-xs font-medium",
              isWarrantyExpired(summary.status)
                ? "text-destructive"
                : summary.status === "paused" || summary.nearExpiry
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground",
            )}
          >
            {isWarrantyExpired(summary.status)
              ? t("orders.warranty.indicator.expired")
              : summary.status === "paused"
                ? t("orders.warranty.status.paused")
                : summary.remaining
                  ? remainingDurationLabel(summary.remaining, (key, options) => String(t(key, options as never)))
                  : t(`orders.warranty.status.${summary.status}`)}
          </span>
        ) : !hasSnapshots ? (
          <span className="text-xs text-muted-foreground">{t("orders.warranty.notStartedHint")}</span>
        ) : null}
      </div>

      {hasSnapshots ? (
        <ul className="space-y-2">
          {lines.map(({ snapshot, evaluation }) => (
            <CoverageRow key={snapshot.id} snapshot={snapshot} evaluation={evaluation} language={i18n.language || "en"} />
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {configuredLines.map((line) => (
            <li key={line.key} className="min-w-0">
              <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{line.name}</p>
              <OrderLineWarrantyBadge limits={line.limits} mileageUnit={orderUnit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CoverageRow({
  snapshot,
  evaluation,
  language,
}: {
  snapshot: WarrantySnapshot;
  evaluation: ReturnType<typeof evaluateWarranty>;
  language: string;
}) {
  const { t } = useTranslation();
  const unit = mileageUnitAbbreviation(snapshotMileageUnit(snapshot), t);
  const dateLabel = formatWarrantyEndsOn(evaluation.expiresOn);
  const startDateLabel = formatWarrantyEndsOn(snapshot.startsAt?.slice(0, 10) ?? null);
  const remainingKm =
    evaluation.remainingMileage != null && evaluation.remainingMileage > 0
      ? formatWarrantyKm(evaluation.remainingMileage, language)
      : null;
  const expired = isWarrantyExpired(evaluation.status);
  const paused = evaluation.status === "paused";

  return (
    <li className="min-w-0 border-t border-border pt-2 first:border-0 first:pt-0">
      <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{snapshot.itemName}</p>
      <OrderLineWarrantyBadge
        activated
        status={evaluation.status}
        startsAt={snapshot.startsAt}
        mileageUnit={snapshotMileageUnit(snapshot)}
        limits={{
          durationMonths: snapshot.durationMonths,
          durationDays: snapshot.durationDays ?? null,
          mileageLimit: snapshot.mileageLimit,
        }}
      />
      <p
        className={cn(
          "mt-0.5 text-[11px] tabular-nums",
          expired ? "text-destructive" : paused ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {paused
          ? startDateLabel
            ? t("orders.warranty.pausedSinceClose", { date: startDateLabel })
            : t("orders.warranty.status.paused")
          : expired
            ? evaluation.status === "expired_mileage"
              ? [
                  t("orders.warranty.status.expired_mileage"),
                  evaluation.expiresAtMileage != null
                    ? t("orders.warranty.indicator.expiredAtKm", {
                        value: formatWarrantyKm(evaluation.expiresAtMileage, language),
                        unit,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : [t("orders.warranty.status.expired_date"), dateLabel].filter(Boolean).join(" · ")
            : [
                dateLabel ? t("orders.warranty.indicator.untilDate", { date: dateLabel }) : null,
                remainingKm ? t("orders.warranty.indicator.remainingKm", { value: remainingKm, unit }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
      </p>
    </li>
  );
}
