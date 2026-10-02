import { useEffect, useRef, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ReportDocument } from "./ReportDocument";

type ReportDocumentProps = ComponentProps<typeof ReportDocument>;

export type ReportPrintJob = Omit<ReportDocumentProps, "formatMoney" | "formatDate"> & { documentTitle: string };

type ReportPrintRootProps = Pick<ReportDocumentProps, "formatMoney" | "formatDate"> & {
  job: ReportPrintJob;
  onDone: () => void;
};

// Rendered as a direct child of <body>; index.css hides every other body child while printing.
export function ReportPrintRoot({ job, formatMoney, formatDate, onDone }: ReportPrintRootProps) {
  const printedJob = useRef<ReportPrintJob | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = job.documentTitle;
    window.addEventListener("afterprint", onDone);
    // StrictMode re-runs effects in development; the ref keeps it to one print dialog per job.
    if (printedJob.current !== job) {
      printedJob.current = job;
      window.print();
    }
    return () => {
      window.removeEventListener("afterprint", onDone);
      document.title = previousTitle;
    };
  }, [job, onDone]);

  return createPortal(
    <div data-report-print-root="" className="hidden print:block">
      <ReportDocument
        title={job.title}
        description={job.description}
        workspaceName={job.workspaceName}
        periodLabel={job.periodLabel}
        generatedLabel={job.generatedLabel}
        model={job.model}
        formatMoney={formatMoney}
        formatDate={formatDate}
      />
    </div>,
    document.body,
  );
}
