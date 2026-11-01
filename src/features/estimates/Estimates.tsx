import { useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Column } from "../../ui/DataTable";
import type { EstimateRecord } from "../../services/apiEstimates";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { DateCell, Stage9ListPage, StatusCell } from "../stage9/Stage9ListPage";
import { useStatusLookup } from "../stage9/useStatusLookup";
import { EstimateFormDialog } from "./EstimateFormDialog";
import { useGetEstimates } from "./useGetEstimates";
import { useDeleteEstimate } from "./useEstimateMutations";

export function Estimates() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useGetEstimates();
  const statuses = useStatusLookup();
  const { formatMoney } = useWorkspaceMoney();
  const deleteEstimate = useDeleteEstimate();
  const [addOpen, setAddOpen] = useState(false);

  const columns: Column<EstimateRecord>[] = [
    {
      key: "number",
      header: t("stage9.columns.id"),
      className: "w-[120px] whitespace-nowrap",
      cell: (estimate) => (
        <span className="font-mono text-xs text-muted-foreground">{estimate.number ?? estimate.id.slice(0, 8)}</span>
      ),
    },
    {
      key: "name",
      header: t("stage9.columns.name"),
      cell: (estimate) => (
        <span className="font-medium text-foreground">
          {estimate.number
            ? t("stage9.estimates.named", { number: estimate.number })
            : t("stage9.estimates.unnamed")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (estimate) => <StatusCell statusId={estimate.statusId} lookup={statuses} />,
    },
    {
      key: "total",
      header: t("stage9.estimates.total"),
      className: "hidden text-right whitespace-nowrap sm:table-cell",
      cell: (estimate) => (
        <span className="font-semibold tabular-nums">{estimate.total == null ? "—" : formatMoney(estimate.total)}</span>
      ),
    },
    {
      key: "created",
      header: t("stage9.columns.createdAt"),
      className: "hidden md:table-cell",
      cell: (estimate) => <DateCell value={estimate.createdAt} />,
    },
  ];

  return (
    <>
      <Stage9ListPage
        module="estimates"
        table="estimates"
        icon={FileText}
        columns={columns}
        keyExtractor={(estimate) => estimate.id}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        onAdd={() => setAddOpen(true)}
        onDelete={(estimate) => deleteEstimate.mutate(estimate.id)}
        rowLabel={(estimate) => estimate.number ?? estimate.id.slice(0, 8)}
        isMutating={deleteEstimate.isPending}
      />
      <EstimateFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
