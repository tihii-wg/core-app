import { StatusBadge } from "../../ui/StatusBadge";
import type { ClientType } from "../../lib/types";

const clientTypeDisplay: Record<ClientType, { label: string; variant: "success" | "info" }> = {
  individual: { label: "Individual", variant: "success" },
  organization: { label: "Organization", variant: "info" },
};

export default function ClientTypeBadge({ clientType }: { clientType: ClientType | null | undefined }) {
  if (!clientType) return null;
  const { label, variant } = clientTypeDisplay[clientType];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}
