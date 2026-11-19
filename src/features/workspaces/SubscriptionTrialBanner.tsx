import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, X } from "lucide-react";
import { currentIntlLocale } from "../../i18n";
import { useWorkspaceSubscription } from "./useWorkspaceSubscription";
import { isTrialExpired, parseSubscriptionTimestamp, subscriptionDaysLeft } from "./workspaceSubscription";

const DISMISS_KEY_PREFIX = "core-app:trial-banner-hidden:";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readDismissed(workspaceId: string | null) {
  if (!workspaceId) return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY_PREFIX + workspaceId) === todayKey();
  } catch {
    return false;
  }
}

/**
 * App-wide trial notice above every page of the active workspace.
 * - Running trial: days left + end date (can be hidden until tomorrow).
 * - Trial over: the workspace is view-only (always shown; page-level read-only notices skip this case).
 * Nothing for paid / admin-set subscriptions, and nothing while the subscription is still loading.
 */
export function SubscriptionTrialBanner() {
  const { t } = useTranslation();
  const { workspaceId, subscription, status, expiresAt, isEntitlementPending, error } = useWorkspaceSubscription();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  if (isEntitlementPending || error || status !== "trial") return null;

  const expiry = parseSubscriptionTimestamp(expiresAt);
  const dateLabel = expiry
    ? expiry.toLocaleDateString(currentIntlLocale(), { year: "numeric", month: "long", day: "numeric" })
    : "";

  if (isTrialExpired(subscription)) {
    return (
      <div
        role="status"
        data-testid="subscription-trial-expired"
        className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
      >
        <p className="font-medium">{t("settings.subscription.trial.expiredTitle")}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.subscription.trial.expiredDescription", { date: dateLabel })}
        </p>
      </div>
    );
  }

  if (hiddenFor === workspaceId || readDismissed(workspaceId)) return null;

  const daysLeft = subscriptionDaysLeft(expiresAt) ?? 0;

  const dismiss = () => {
    if (!workspaceId) return;
    try {
      window.localStorage.setItem(DISMISS_KEY_PREFIX + workspaceId, todayKey());
    } catch {
      // Storage unavailable: hide for this session only.
    }
    setHiddenFor(workspaceId);
  };

  return (
    <div
      role="status"
      data-testid="subscription-trial"
      className="mb-4 flex items-start gap-2.5 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground"
    >
      <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("settings.subscription.trial.title", { count: daysLeft })}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t("settings.subscription.trial.description", { date: dateLabel })}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="-mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("settings.subscription.trial.dismiss")}
        title={t("settings.subscription.trial.dismiss")}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
