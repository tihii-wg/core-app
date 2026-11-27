import { memo } from "react";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Service } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import { StatusBadge } from "../../ui/StatusBadge";

type ServiceCardProps = {
  service: Service;
  categoryLabel: string;
  formatMoney: (value: number) => string;
  /** Omitted when the user cannot manage services. */
  onEdit?: (service: Service) => void;
  onDelete?: (service: Service) => void;
};

/**
 * Compact phone layout for one service (below the md breakpoint), same look as the client and
 * order cards. Tapping it opens the edit form (as a table row click does).
 * Memoized: it re-renders only when its own data changes.
 */
export const ServiceCard = memo(function ServiceCard({ service, categoryLabel, formatMoney, onEdit, onDelete }: ServiceCardProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const inactive = service.status === "inactive";

  return (
    <article
      onClick={onEdit ? () => onEdit(service) : undefined}
      className={cn(
        "rounded-lg border border-border bg-card p-3 shadow-xs transition-colors",
        onEdit && "cursor-pointer hover:bg-accent/40 active:bg-accent/60",
        inactive && "bg-muted/20",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold [overflow-wrap:anywhere]", inactive ? "text-muted-foreground" : "text-foreground")}>
            {service.service_name}
          </p>
          {service.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{service.description}</p> : null}
          {categoryLabel ? (
            <div className="mt-1">
              <StatusBadge variant="default">{categoryLabel}</StatusBadge>
            </div>
          ) : null}
        </div>
        {onEdit || onDelete ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-10 shrink-0"
                aria-label={t("services.editAriaLabel", { name: service.service_name })}
                onClick={stop}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" onClick={stop}>
              {onEdit ? (
                <DropdownMenuItem onSelect={() => onEdit(service)}>
                  <Pencil />
                  {t("common.edit")}
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(service)}>
                  <Trash2 />
                  {t("common.delete")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-center gap-3 border-t border-border pt-2.5 text-sm">
        {inactive ? (
          <StatusBadge variant="muted" dot>
            {t("services.statuses.inactive")}
          </StatusBadge>
        ) : (
          <StatusBadge variant="success" dot>
            {t("services.statuses.active")}
          </StatusBadge>
        )}
        <span className={cn("ml-auto font-semibold tabular-nums", inactive ? "text-muted-foreground" : "text-foreground")}>
          {formatMoney(service.service_price)}
        </span>
      </div>
    </article>
  );
});
