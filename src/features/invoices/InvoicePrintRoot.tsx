import { useEffect, useRef, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { InvoicePrintDocument } from "./InvoicePrintDocument";

type InvoicePrintDocumentProps = ComponentProps<typeof InvoicePrintDocument>;

export type InvoicePrintJob = InvoicePrintDocumentProps & { documentTitle: string };

type InvoicePrintRootProps = {
  job: InvoicePrintJob;
  onDone: () => void;
};

// Rendered as a direct child of <body>; globals.css hides every other
// body child while printing (same mechanism as ReportPrintRoot).
// PDF output is produced by the browser print pipeline
// (Print / Save as PDF), which handles A4 paging and repeated
// table headers via the global print stylesheet.
function waitForImages(root: HTMLElement | null): Promise<void> {
  const images = Array.from(root?.querySelectorAll("img") ?? []);
  if (images.length === 0) return Promise.resolve();
  const loaded = images.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) return resolve();
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }),
  );
  // Never block printing forever on a broken image.
  return Promise.race([Promise.all(loaded).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
}

export function InvoicePrintRoot({ job, onDone }: InvoicePrintRootProps) {
  const printedJob = useRef<InvoicePrintJob | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = job.documentTitle;
    window.addEventListener("afterprint", onDone);
    // StrictMode re-runs effects in development; the ref keeps it to one print dialog per job.
    if (printedJob.current !== job) {
      printedJob.current = job;
      // Wait until the company logo image has actually loaded so it
      // is present in the print/PDF output instead of racing it.
      void waitForImages(rootRef.current).then(() => window.print());
    }
    return () => {
      window.removeEventListener("afterprint", onDone);
      document.title = previousTitle;
    };
  }, [job, onDone]);

  return createPortal(
    <div ref={rootRef} data-invoice-print-root="" className="hidden print:block">
      <InvoicePrintDocument
        invoice={job.invoice}
        sections={job.sections}
        companyName={job.companyName}
        logoUrl={job.logoUrl}
        supplier={job.supplier}
        formatMoney={job.formatMoney}
      />
    </div>,
    document.body,
  );
}
