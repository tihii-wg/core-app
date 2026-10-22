import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Loader2, Printer } from "lucide-react";
import { Button } from "../../ui/Button";
import type { Invoice, InvoiceDocument } from "../../lib/types";
import { getInvoice } from "../../services/apiInvoices";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useInvoiceDocumentData } from "./useInvoiceDocumentData";
import { InvoicePrintRoot, type InvoicePrintJob } from "./InvoicePrintRoot";

/**
 * Quick-print for one invoice row. Loads the full invoice document,
 * assembles the printable data through the same hook the detail
 * panel uses (workspace settings, legal entity, logo, works /
 * materials), and only then opens the browser print dialog via
 * InvoicePrintRoot. The invoice detail panel is never opened.
 */
export function InvoicePrintButton({ invoice, triggerClassName }: { invoice: Invoice; triggerClassName?: string }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  const documentQuery = useQuery({
    queryKey: ["invoice-row-print", invoice.workspaceId, invoice.id],
    queryFn: () => getInvoice(invoice.id, invoice.workspaceId),
    enabled: active,
    retry: false,
  });

  useEffect(() => {
    if (!active || !documentQuery.error) return;
    toast.error(documentQuery.error instanceof Error ? documentQuery.error.message : t("invoices.detail.loadErrorTitle"), { id: `invoice-print-${invoice.id}` });
    setActive(false);
  }, [active, documentQuery.error, invoice.id, t]);

  const busy = active;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={triggerClassName}
        disabled={busy}
        aria-label={t("invoices.actions.print")}
        title={t("invoices.actions.print")}
        onClick={(event) => {
          // Never trigger the row's detail-panel navigation.
          event.stopPropagation();
          if (!busy) setActive(true);
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Printer aria-hidden="true" />}
      </Button>
      {active && documentQuery.data ? (
        <InvoiceRowPrintJob invoice={documentQuery.data} onDone={() => setActive(false)} />
      ) : null}
    </>
  );
}

function InvoiceRowPrintJob({ invoice, onDone }: { invoice: InvoiceDocument; onDone: () => void }) {
  const { formatMoney } = useWorkspaceMoney();
  const documentData = useInvoiceDocumentData(invoice);
  const [job, setJob] = useState<InvoicePrintJob | null>(null);

  useEffect(() => {
    if (documentData.isLoading || job) return;
    setJob({
      invoice,
      sections: documentData.sections,
      companyName: documentData.companyName,
      logoUrl: documentData.logoUrl,
      supplier: documentData.supplier,
      formatMoney,
      documentTitle: `${invoice.invoiceNumber}.pdf`,
    });
  }, [documentData, formatMoney, invoice, job]);

  if (!job) return null;
  return <InvoicePrintRoot job={job} onDone={onDone} />;
}
