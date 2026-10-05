import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import type { LucideIcon } from "lucide-react";
import { SearchX, Package, FileText, Users, AlertTriangle, RotateCw, Plus } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon = SearchX, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-card shadow-xs">
        <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>}
      {action && (
        <Button onClick={action.onClick} size="sm" className="mt-5">
          <Plus />
          {action.label}
        </Button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export function ErrorState({ title, description, onRetry, isRetrying, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" className="size-5" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title ?? t("common.somethingWentWrong")}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description ?? t("common.errors.loadFailedDescription")}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry} loading={isRetrying}>
          {!isRetrying && <RotateCw />}
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

// Preset empty states
export function NoSearchResults({ query }: { query: string }) {
  const { t } = useTranslation();
  return <EmptyState icon={SearchX} title={t("common.empty.noResultsTitle")} description={t("common.empty.noResultsDescription", { query })} />;
}

export function NoOrders({ onCreateOrder }: { onCreateOrder: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon={FileText} title={t("common.empty.noOrdersTitle")} description={t("common.empty.noOrdersDescription")} action={{ label: t("common.empty.noOrdersAction"), onClick: onCreateOrder }} />;
}

export function NoClients({ onAddClient }: { onAddClient: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon={Users} title={t("common.empty.noClientsTitle")} description={t("common.empty.noClientsDescription")} action={{ label: t("common.empty.noClientsAction"), onClick: onAddClient }} />;
}
export function NoServices({ onAddService }: { onAddService?: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon={Package} title={t("common.empty.noServicesTitle")} description={t("common.empty.noServicesDescription")} action={onAddService ? { label: t("common.empty.noServicesAction"), onClick: onAddService } : undefined} />;
}

export function NoInventory({ onAddItem }: { onAddItem: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon={Package} title={t("common.empty.noInventoryTitle")} description={t("common.empty.noInventoryDescription")} action={{ label: t("common.empty.noInventoryAction"), onClick: onAddItem }} />;
}

export function NoEmployees({ onAddClient }: { onAddClient: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon={Users} title={t("common.empty.noEmployeesTitle")} description={t("common.empty.noEmployeesDescription")} action={{ label: t("common.empty.noEmployeesAction"), onClick: onAddClient }} />;
}
