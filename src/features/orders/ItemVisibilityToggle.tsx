import { Lock, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

type ItemVisibilityToggleProps = {
  isPublic: boolean | undefined;
  /** Author / uploader or workspace owner. */
  canChange: boolean;
  pending?: boolean;
  onChange: (isPublic: boolean) => void;
  className?: string;
};

/** «Приватный / Публичный» chip; a button for whoever may switch it, a plain mark for the others. */
export function ItemVisibilityToggle({ isPublic, canChange, pending, onChange, className }: ItemVisibilityToggleProps) {
  const { t } = useTranslation();
  if (isPublic === undefined) return null;
  const label = isPublic ? t("orders.visibility.public") : t("orders.visibility.private");
  const hint = isPublic ? t("orders.visibility.publicHint") : t("orders.visibility.privateHint");
  const Icon = isPublic ? Users : Lock;
  const chipClass = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
    isPublic ? "border-border text-muted-foreground" : "border-warning/40 bg-warning/10 text-foreground",
    className,
  );
  if (!canChange) {
    // Others only ever see public items, so a mark is shown just for the private ones (author / owner view).
    return isPublic ? null : (
      <span className={chipClass} title={hint}>
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn(chipClass, "hover:bg-muted disabled:opacity-60")}
      title={`${hint}. ${isPublic ? t("orders.visibility.makePrivate") : t("orders.visibility.makePublic")}`}
      aria-label={isPublic ? t("orders.visibility.makePrivate") : t("orders.visibility.makePublic")}
      disabled={pending}
      onClick={() => onChange(!isPublic)}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </button>
  );
}
