import { accessLabel } from "@/data/subscription";
import type { SubscriptionStatus } from "@/data/types";
import { useT } from "@/i18n/I18nProvider";
import { Badge } from "./ui";

export function AccessBadge({ status, expiresAt }: { status: SubscriptionStatus | null; expiresAt: string | null }) {
  const t = useT();
  const label = accessLabel(status, expiresAt);
  return <Badge tone={label === "writable" ? "success" : "danger"}>{t(`access.${label}`)}</Badge>;
}
