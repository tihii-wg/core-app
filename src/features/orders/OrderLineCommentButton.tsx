import { MessageSquare, MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

type OrderLineCommentButtonProps = {
  testId: string;
  /** The line already has a comment: highlighted icon, «edit» label. */
  hasComment: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** Always-visible comment control next to the line pencil (>= 44px tap target). */
export function OrderLineCommentButton({ testId, hasComment, active = false, disabled, onClick }: OrderLineCommentButtonProps) {
  const { t } = useTranslation();
  const label = t(hasComment ? "orders.lineComments.edit" : "orders.lineComments.addLabel");
  const Icon = hasComment ? MessageSquareText : MessageSquare;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "inline-flex size-11 shrink-0 sm:size-8 items-center justify-center rounded-md transition-colors outline-none",
        "hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35",
        "disabled:pointer-events-none disabled:opacity-50",
        hasComment || active ? "text-primary" : "text-muted-foreground",
      )}
      // Keep the focus in an open comment editor (its blur would save half-typed text).
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
