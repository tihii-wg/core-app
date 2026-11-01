import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import type { LeadRecord } from "../../services/apiLeads";
import { DateCell, Stage9ListPage, StatusCell } from "../stage9/Stage9ListPage";
import { useStatusLookup } from "../stage9/useStatusLookup";
import { LeadFormDialog } from "./LeadFormDialog";
import { useGetLeads } from "./useGetLeads";
import { useDeleteLead } from "./useLeadMutations";

export function Leads() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useGetLeads();
  const statuses = useStatusLookup();
  const deleteLead = useDeleteLead();
  const [addOpen, setAddOpen] = useState(false);

  const columns: Column<LeadRecord>[] = [
    {
      key: "number",
      header: t("stage9.columns.id"),
      className: "w-[120px] whitespace-nowrap",
      cell: (lead) => <span className="font-mono text-xs text-muted-foreground">{lead.number ?? lead.id.slice(0, 8)}</span>,
    },
    {
      key: "name",
      header: t("stage9.columns.name"),
      cell: (lead) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{lead.contactName ?? t("stage9.leads.unnamed")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t(`stage9.leads.types.${lead.leadType}`)}
            {lead.phone ? ` · ${lead.phone}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (lead) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusCell statusId={lead.statusId} lookup={statuses} />
          {lead.isUrgent ? <StatusBadge variant="danger">{t("stage9.leads.urgent")}</StatusBadge> : null}
        </div>
      ),
    },
    {
      key: "created",
      header: t("stage9.columns.createdAt"),
      className: "hidden sm:table-cell",
      cell: (lead) => <DateCell value={lead.createdAt} withTime />,
    },
  ];

  return (
    <>
      <Stage9ListPage
        module="leads"
        table="leads"
        icon={ClipboardList}
        columns={columns}
        keyExtractor={(lead) => lead.id}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        onAdd={() => setAddOpen(true)}
        onDelete={(lead) => deleteLead.mutate(lead.id)}
        rowLabel={(lead) => lead.contactName ?? lead.phone ?? lead.number ?? lead.id.slice(0, 8)}
        isMutating={deleteLead.isPending}
      />
      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
