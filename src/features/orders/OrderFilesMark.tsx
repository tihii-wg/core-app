import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

/** Small floppy-disk mark with the number of files attached to an order (hidden when there are none). */
export function OrderFilesMark({ count, className }: { count: number | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!count) return null;
  const label = t("orders.attachments.listMark", { count });
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground tabular-nums", className)}
      title={label}
      aria-label={label}
    >
      <Save className="size-3.5" aria-hidden />
      {count}
    </span>
  );
}
