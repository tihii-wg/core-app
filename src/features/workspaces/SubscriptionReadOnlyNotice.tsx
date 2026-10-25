import { useTranslation } from "react-i18next";
import { currentIntlLocale } from "../../i18n";
import { useWorkspaceSubscription } from "./useWorkspaceSubscription";
import { parseSubscriptionTimestamp } from "./workspaceSubscription";

type SubscriptionReadOnlyNoticeProps = {
  className?: string;
};

const defaultNoticeClassName =
  "rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground";

/**
 * Shown when the active workspace lacks subscription write entitlement.
 * Hidden while entitlement is still loading — loading must not look like expiry.
 */
export function SubscriptionReadOnlyNotice({ className }: SubscriptionReadOnlyNoticeProps) {
  const { t } = useTranslation();
  const { canWrite, status, expiresAt, isEntitlementPending, error, refetch } = useWorkspaceSubscription();

  if (isEntitlementPending) return null;

  if (error) {
    return (
      <div
        role="alert"
        className={className ?? "rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground"}
      >
        <p className="font-medium">{t("settings.subscription.loadFailed")}</p>
        <button type="button" className="mt-1 text-[13px] text-primary underline" onClick={() => void refetch()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (canWrite) return null;

  const expiry = parseSubscriptionTimestamp(expiresAt);
  const expiryLabel = expiry
    ? expiry.toLocaleDateString(currentIntlLocale(), { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div role="status" className={className ?? defaultNoticeClassName}>
      <p className="font-medium">{t("settings.subscription.readOnlyTitle")}</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {expiryLabel
          ? t("settings.subscription.readOnlyWithExpiry", {
              status: t(`settings.subscription.status.${status ?? "unknown"}`),
              date: expiryLabel,
            })
          : t("settings.subscription.readOnlyDescription", {
              status: t(`settings.subscription.status.${status ?? "unknown"}`),
            })}
      </p>
    </div>
  );
}
