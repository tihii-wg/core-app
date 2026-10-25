import { useTranslation } from "react-i18next";
import { currentIntlLocale } from "../../i18n";
import { useWorkspaceSubscription } from "./useWorkspaceSubscription";
import { parseSubscriptionTimestamp } from "./workspaceSubscription";

type SubscriptionReadOnlyNoticeProps = {
  className?: string;
};

/** Shown when the active workspace lacks subscription write entitlement. */
export function SubscriptionReadOnlyNotice({ className }: SubscriptionReadOnlyNoticeProps) {
  const { t } = useTranslation();
  const { canWrite, status, expiresAt, isLoading } = useWorkspaceSubscription();

  if (isLoading || canWrite) return null;

  const expiry = parseSubscriptionTimestamp(expiresAt);
  const expiryLabel = expiry
    ? expiry.toLocaleDateString(currentIntlLocale(), { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div
      role="status"
      className={
        className ??
        "rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
      }
    >
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
