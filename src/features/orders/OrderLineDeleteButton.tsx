import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

type OrderLineDeleteButtonProps = {
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
};

/** Compact trash control for order card line rows (>= 44px tap target). */
export function OrderLineDeleteButton({ testId, disabled, onClick, className }: OrderLineDeleteButtonProps) {
  const { t } = useTranslation();
  const label = t("orders.lineDelete.ariaLabel");
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex size-11 shrink-0 sm:size-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-colors outline-none hover:bg-destructive/10 hover:text-destructive",
        "focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
