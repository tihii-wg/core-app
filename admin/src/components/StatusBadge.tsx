import type { SubscriptionStatus } from "@/data/types";
import { useT } from "@/i18n/I18nProvider";
import { Badge } from "./ui";

export function StatusBadge({ status }: { status: SubscriptionStatus | null }) {
  const t = useT();
  if (!status) return <Badge tone="muted">{t("common.unknown")}</Badge>;
  const tone =
    status === "active"
      ? "success"
      : status === "trial"
        ? "info"
        : status === "expired" || status === "suspended" || status === "cancelled"
          ? "danger"
          : "muted";
  return <Badge tone={tone}>{t(`status.${status}`)}</Badge>;
}
