import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DatabaseZap, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { DataTable, type Column } from "../../ui/DataTable";
import { EmptyState, ErrorState } from "../../ui/EmptyState";
import { EntityStatusBadge } from "../../ui/StatusBadge";
import { useConfirm } from "../../ui/ConfirmProvider";
import type { Stage9ListResult } from "../../services/apiStage9List";
import { useReportFormatting } from "../reports/reportFormatting";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import type { StatusLookup } from "./useStatusLookup";

export type Stage9Module = "leads" | "estimates" | "tasks" | "bookings";

type Stage9ListPageProps<T> = {
  module: Stage9Module;
  /** Table name shown in the "SQL dependency" note. */
  table: string;
  icon: LucideIcon;
  columns: Column<T>[];
  keyExtractor: (row: T) => string;
  data: Stage9ListResult<T> | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Opens the module's "Add" dialog. Omit for a read-only module. */
  onAdd?: () => void;
  /** Opens the module's edit dialog for a row (optional). */
  onEdit?: (row: T) => void;
  /** Soft-deletes a row (the page asks for confirmation first). */
  onDelete?: (row: T) => void;
  /** Human label of a row, used in the delete confirmation. */
  rowLabel?: (row: T) => string;
  /** Disables row actions while a write is in flight. */
  isMutating?: boolean;
};

/**
 * List page for a Stage 9 module: loading, error, unavailable (table missing), empty and table states,
 * plus optional Add / Edit / Delete actions (hidden when the subscription is read-only; RLS still decides per user).
 */
export function Stage9ListPage<T>({
  module,
  table,
  icon,
  columns,
  keyExtractor,
  data,
  isLoading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
  rowLabel,
  isMutating = false,
}: Stage9ListPageProps<T>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { canWrite } = useWorkspaceSubscription();
  const rows = data?.rows ?? [];
  const writable = canWrite && Boolean(onAdd || onEdit || onDelete);
  const showAdd = writable && Boolean(onAdd) && Boolean(data) && !data?.isUnavailable && !error;

  const actionColumn: Column<T> | null =
    writable && (onEdit || onDelete)
      ? {
          key: "actions",
          header: t("stage9.columns.actions"),
          className: "w-[96px] text-right whitespace-nowrap",
          cell: (row) => (
            <div className="flex items-center justify-end gap-1">
              {onEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isMutating}
                  aria-label={t("stage9.actions.edit")}
                  title={t("stage9.actions.edit")}
                  onClick={() => onEdit(row)}
                >
                  <Pencil />
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isMutating}
                  aria-label={t("stage9.actions.delete")}
                  title={t("stage9.actions.delete")}
                  onClick={() => {
                    void (async () => {
                      if (
                        !(await confirm({
                          title: t("common.deleteTitle"),
                          description: t("stage9.actions.deleteConfirm", { name: rowLabel ? rowLabel(row) : "" }),
                          confirmLabel: t("common.delete"),
                          tone: "destructive",
                        }))
                      ) {
                        return;
                      }
                      onDelete(row);
                    })();
                  }}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ),
        }
      : null;
  const allColumns = actionColumn ? [...columns, actionColumn] : columns;

  let emptyState: ReactNode;
  if (error) {
    emptyState = <ErrorState title={t("stage9.loadError")} description={error.message} onRetry={onRetry} />;
  } else if (data?.isUnavailable) {
    emptyState = (
      <EmptyState
        icon={DatabaseZap}
        title={t("stage9.unavailable.title")}
        description={t("stage9.unavailable.description", { table })}
      />
    );
  } else {
    emptyState = <EmptyState icon={icon} title={t(`stage9.${module}.empty`)} description={t(`stage9.${module}.emptyHint`)} />;
  }

  const description = isLoading
    ? t("stage9.loading")
    : data && !data.isUnavailable && !error
      ? t("stage9.count", { count: rows.length })
      : t(`stage9.${module}.description`);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(`stage9.${module}.title`)}
        description={description}
        actions={
          showAdd ? (
            <Button type="button" onClick={onAdd}>
              <Plus />
              {t(`stage9.${module}.add`)}
            </Button>
          ) : null
        }
      />
      {!writable ? <p className="text-xs text-muted-foreground">{t("stage9.readOnlyNote", { table })}</p> : null}
      <DataTable
        columns={allColumns}
        data={error ? [] : rows}
        isLoading={isLoading}
        keyExtractor={keyExtractor}
        emptyState={emptyState}
      />
    </div>
  );
}

export function StatusCell({ statusId, lookup }: { statusId: string | null; lookup: StatusLookup }) {
  const status = statusId ? lookup.get(statusId) : undefined;
  if (!status) return <span className="text-subtle-foreground">—</span>;
  return <EntityStatusBadge name={status.name} color={status.color} />;
}

export function DateCell({ value, withTime = false }: { value: string | null; withTime?: boolean }) {
  const { formatDate, formatDateTime } = useReportFormatting();
  if (!value) return <span className="text-subtle-foreground">—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-subtle-foreground">—</span>;
  return (
    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
      {withTime ? formatDateTime(date) : formatDate(value)}
    </span>
  );
}
