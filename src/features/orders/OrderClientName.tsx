import { cn } from "../../lib/utils";
import { ClientNameWithMark } from "../clients/ClientNameWithMark";

type OrderClientNameProps = {
  clientId?: string | null;
  clientName: string;
  className?: string;
  onOpenClient: (clientId: string) => void;
};

/** Clickable client name for order rows. Orders without a client stay plain text. */
export function OrderClientName({ clientId, clientName, className, onOpenClient }: OrderClientNameProps) {
  const id = clientId?.trim() ?? "";

  if (!id) {
    return (
      <span className={className} title={clientName}>
        <ClientNameWithMark clientId={clientId}>{clientName}</ClientNameWithMark>
      </span>
    );
  }

  return (
    <button
      type="button"
      title={clientName}
      className={cn(
        "max-w-full truncate text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onOpenClient(id);
      }}
    >
      <ClientNameWithMark clientId={id}>{clientName}</ClientNameWithMark>
    </button>
  );
}
