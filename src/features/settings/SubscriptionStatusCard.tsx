import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { StatusBadge } from "../../ui/StatusBadge";
import { currentIntlLocale } from "../../i18n";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import {
  parseSubscriptionTimestamp,
  subscriptionStatusBadgeVariant,
} from "../workspaces/workspaceSubscription";
import { Skeleton } from "../../ui/Skeleton";

function formatDate(value: string | null) {
  const date = parseSubscriptionTimestamp(value);
  if (!date) return null;
  return date.toLocaleDateString(currentIntlLocale(), { year: "numeric", month: "short", day: "numeric" });
}

/** Read-only workspace subscription status for Settings → Billing. */
export function SubscriptionStatusCard() {
  const { t } = useTranslation();
  const { status, expiresAt, canWrite, isLoading, error, refetch } = useWorkspaceSubscription();

  const statusKey = status ?? "unknown";
  const statusLabel = t(`settings.subscription.status.${statusKey}`);
  const expiryLabel = formatDate(expiresAt);
  const badgeVariant = subscriptionStatusBadgeVariant(status, canWrite);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.subscription.title")}</CardTitle>
        <CardDescription>{t("settings.subscription.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-foreground">{t("settings.subscription.loadFailed")}</p>
            <button type="button" className="mt-2 text-sm text-primary underline" onClick={() => void refetch()}>
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted-foreground">{t("settings.subscription.statusLabel")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={badgeVariant} dot>
                    {statusLabel}
                  </StatusBadge>
                  {!canWrite ? (
                    <span className="text-xs text-muted-foreground">{t("settings.subscription.viewOnlyBadge")}</span>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 text-sm">
                <p className="text-muted-foreground">{t("settings.subscription.expiresLabel")}</p>
                <p className="font-medium text-foreground">{expiryLabel ?? t("settings.subscription.noExpiry")}</p>
              </div>
            </div>

            {!canWrite ? (
              <div role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{t("settings.subscription.readOnlyTitle")}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {expiryLabel
                    ? t("settings.subscription.readOnlyWithExpiry", { status: statusLabel, date: expiryLabel })
                    : t("settings.subscription.readOnlyDescription", { status: statusLabel })}
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("settings.subscription.activeHint")}</p>
            )}

            <p className="text-[12px] text-subtle-foreground">{t("settings.subscription.noSelfService")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
