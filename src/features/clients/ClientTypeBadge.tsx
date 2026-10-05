import { useTranslation } from "react-i18next";
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
