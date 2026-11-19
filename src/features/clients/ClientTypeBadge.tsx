import { useTranslation } from "react-i18next";
import { Building2, UserRound } from "lucide-react";
import { StatusBadge } from "../../ui/StatusBadge";
import type { ClientType } from "../../lib/types";

const clientTypeVariant: Record<ClientType, "default" | "violet"> = {
  individual: "default",
  organization: "violet",
};

export default function ClientTypeBadge({ clientType }: { clientType: ClientType | null | undefined }) {
  const { t } = useTranslation();
  if (!clientType) return null;
  return <StatusBadge variant={clientTypeVariant[clientType]}>{t(`clients.types.${clientType}`)}</StatusBadge>;
}

/** Compact client type for dense rows: an icon (building / person) with the type as tooltip and label. */
export function ClientTypeIcon({ clientType }: { clientType: ClientType | null | undefined }) {
  const { t } = useTranslation();
  if (!clientType) return null;
  const label = t(`clients.types.${clientType}`);
  const Icon = clientType === "organization" ? Building2 : UserRound;
  return (
    <span
      className={clientType === "organization" ? "inline-flex shrink-0 text-violet-600 dark:text-violet-400" : "inline-flex shrink-0 text-muted-foreground"}
      title={label}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
