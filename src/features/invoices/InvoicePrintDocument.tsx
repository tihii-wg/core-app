import { useTranslation } from "react-i18next";
import type { InvoiceDocument, InvoiceItem } from "../../lib/types";
import { lineTotal, type InvoiceSections } from "./invoiceItemSections";

export type InvoiceSupplierInfo = {
  /** Legal/business name shown as the supplier. */
  name: string;
  address: string;
  registrationNumber: string;
  taxNumber: string;
  email: string;
  iban: string;
  bankName: string;
  bankCode: string;
  /** Payment instructions / notes printed above the footer. */
  extraInfo: string;
};

type InvoicePrintDocumentProps = {
  invoice: InvoiceDocument;
  sections: InvoiceSections;
  companyName: string;
  logoUrl: string | null;
  supplier: InvoiceSupplierInfo;
  formatMoney: (value: number) => string;
};

const PRIMARY = "#1a6de0";
const PRIMARY_DARK = "#1e3a8a";
const TINT = "#eff6ff";
const TINT_STRONG = "#dbeafe";
const ZEBRA = "#f8fafc";
const INK = "#1f2933";
const MUTED = "#64748b";

function statusAccent(status: InvoiceDocument["status"]) {
  switch (status) {
    case "paid":
      return { bg: "#dcfce7", text: "#15803d", border: "#86efac" };
    case "overdue":
      return { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" };
    case "sent":
      return { bg: TINT_STRONG, text: PRIMARY_DARK, border: "#93c5fd" };
    default:
      return { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };
  }
}

function ItemsTable({ title, items, dense, formatMoney }: { title: string; items: InvoiceItem[]; dense: boolean; formatMoney: (value: number) => string }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const cellY = dense ? "py-[3px]" : "py-[5px]";
  const fontSize = dense ? "text-[11px] leading-snug" : "text-xs leading-snug";

  return (
    <section className="mt-4">
      <h2 className="print-exact flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: PRIMARY_DARK }}>
        <span aria-hidden="true" className="inline-block h-3 w-1 rounded-sm" style={{ background: PRIMARY }} />
        {title}
      </h2>
      <table className={`mt-1.5 w-full border-collapse ${fontSize}`} style={{ color: INK }}>
        <thead>
          <tr className="print-exact" style={{ background: TINT_STRONG, color: PRIMARY_DARK }}>
            <th scope="col" className={`w-8 px-2 ${cellY} text-left text-[10px] font-semibold uppercase tracking-wide`}>{t("invoices.document.number")}</th>
            <th scope="col" className={`px-2 ${cellY} text-left text-[10px] font-semibold uppercase tracking-wide`}>{t("invoices.document.description")}</th>
            <th scope="col" className={`w-14 px-2 ${cellY} text-right text-[10px] font-semibold uppercase tracking-wide`}>{t("invoices.document.quantity")}</th>
            <th scope="col" className={`w-24 px-2 ${cellY} text-right text-[10px] font-semibold uppercase tracking-wide`}>{t("invoices.document.unitPrice")}</th>
            <th scope="col" className={`w-28 px-2 ${cellY} text-right text-[10px] font-semibold uppercase tracking-wide`}>{t("invoices.document.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="break-inside-avoid border-b border-[#eef0f2]" style={index % 2 === 1 ? { background: ZEBRA } : undefined}>
              <td className={`px-2 ${cellY} tabular-nums`} style={{ color: MUTED }}>{index + 1}</td>
              <td className={`px-2 ${cellY} [overflow-wrap:anywhere]`}>{item.serviceName}</td>
              <td className={`px-2 ${cellY} text-right tabular-nums`}>{item.quantity}</td>
              <td className={`px-2 ${cellY} text-right tabular-nums`}>{formatMoney(item.price)}</td>
              <td className={`px-2 ${cellY} text-right font-medium tabular-nums`}>{formatMoney(lineTotal(item))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="print-exact break-inside-avoid font-semibold" style={{ background: TINT, color: PRIMARY_DARK }}>
            <td colSpan={4} className={`px-2 ${cellY} text-right`}>{t("invoices.document.subtotal")}</td>
            <td className={`px-2 ${cellY} text-right tabular-nums`}>{formatMoney(subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function SupplierLine({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <p className="text-xs leading-snug">
      <span style={{ color: MUTED }}>{label}: </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

/**
 * Ordinary payment invoice (not a fiscal document), compact A4
 * portrait layout targeting exactly one page for normal invoices.
 * Rendered through the browser print pipeline (Print / Save as PDF),
 * the same mechanism as the quick-report documents. All values come
 * from the persisted invoice, workspace settings and legal entity;
 * nothing is fabricated when optional data is missing, and no item
 * is ever omitted to force the page fit — unusually long invoices
 * flow to a second page with repeated table headers instead.
 */
export function InvoicePrintDocument({ invoice, sections, companyName, logoUrl, supplier, formatMoney }: InvoicePrintDocumentProps) {
  const { t } = useTranslation();
  const accent = statusAccent(invoice.status);
  const amountDue = invoice.status === "paid" ? 0 : sections.grandTotal;
  const statusLabel = t(`status.invoice.${invoice.status}`, { defaultValue: invoice.status });
  const dense = sections.works.length + sections.materials.length > 12;

  return (
    <article aria-label={t("invoices.document.title", { number: invoice.invoiceNumber })} className="mx-auto w-full max-w-[210mm] bg-white p-4 sm:p-6 print:max-w-none print:p-0" style={{ color: INK }}>
      {/* Header */}
      <header className="print-exact flex items-start justify-between gap-4 rounded-md px-4 py-3 print:rounded-none" style={{ background: PRIMARY, color: "#fff" }}>
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="h-11 w-11 shrink-0 rounded-md bg-white object-contain p-0.5" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight">{supplier.name || companyName}</p>
            {supplier.address ? <p className="text-[11px] leading-snug text-white/85 [overflow-wrap:anywhere]">{supplier.address}</p> : null}
            {supplier.email ? <p className="text-[11px] leading-snug text-white/85">{supplier.email}</p> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">{t("invoices.document.invoice")}</p>
          <p className="text-xl font-bold leading-tight tabular-nums">{invoice.invoiceNumber}</p>
          <span className="print-exact mt-1 inline-block rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide" style={{ background: accent.bg, color: accent.text, borderColor: accent.border }}>
            {statusLabel}
          </span>
        </div>
      </header>

      {/* Meta */}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t("invoices.document.issueDate"), value: invoice.createdAt },
          { label: t("invoices.document.dueDate"), value: invoice.dueDate },
          ...(invoice.orderNumber ? [{ label: t("invoices.document.order"), value: invoice.orderNumber }] : []),
          ...(invoice.paidAt ? [{ label: t("invoices.document.paidOn"), value: invoice.paidAt }] : []),
        ].map((entry) => (
          <div key={entry.label} className="print-exact break-inside-avoid rounded-md px-2.5 py-1.5" style={{ background: TINT }}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: PRIMARY_DARK }}>{entry.label}</dt>
            <dd className="text-xs font-semibold tabular-nums">{entry.value || "—"}</dd>
          </div>
        ))}
      </dl>

      {/* Parties */}
      <div className="mt-3 grid gap-2.5 break-inside-avoid sm:grid-cols-2">
        <section className="rounded-md border border-[#e5e7eb] px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>{t("invoices.document.supplier")}</h2>
          <p className="mt-1 text-xs font-semibold [overflow-wrap:anywhere]">{supplier.name || companyName}</p>
          <SupplierLine label={t("invoices.document.address")} value={supplier.address} />
          <SupplierLine label={t("invoices.document.registration")} value={supplier.registrationNumber} />
          <SupplierLine label={t("invoices.document.tax")} value={supplier.taxNumber} />
          <SupplierLine label={t("invoices.document.email")} value={supplier.email} />
        </section>
        <section className="rounded-md border border-[#e5e7eb] px-3 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>{t("invoices.document.customer")}</h2>
          <p className="mt-1 text-xs font-semibold [overflow-wrap:anywhere]">{invoice.clientName || "—"}</p>
          {invoice.clientPhone ? (
            <p className="text-xs leading-snug">
              <span style={{ color: MUTED }}>{t("invoices.document.phone")}: </span>
              <span className="font-medium">{invoice.clientPhone}</span>
            </p>
          ) : null}
          {invoice.device ? <SupplierLine label={t("invoices.document.device")} value={invoice.device} /> : null}
          {invoice.carNumber ? <SupplierLine label={t("invoices.document.carNumber")} value={invoice.carNumber} /> : null}
          {invoice.vin ? <SupplierLine label={t("invoices.document.vin")} value={invoice.vin} /> : null}
        </section>
      </div>

      {invoice.description ? (
        <section className="mt-3 break-inside-avoid">
          <h2 className="text-[10px] font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>{t("invoices.document.notes")}</h2>
          <p className="mt-0.5 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{invoice.description}</p>
        </section>
      ) : null}

      {/* Items */}
      <ItemsTable title={t("invoices.document.works")} items={sections.works} dense={dense} formatMoney={formatMoney} />
      <ItemsTable title={t("invoices.document.materials")} items={sections.materials} dense={dense} formatMoney={formatMoney} />

      {/* Summary */}
      <section className="mt-4 flex justify-end break-inside-avoid">
        <dl className="w-full max-w-[240px] text-xs">
          {sections.works.length > 0 ? (
            <div className="flex justify-between py-0.5">
              <dt style={{ color: MUTED }}>{t("invoices.document.worksSubtotal")}</dt>
              <dd className="tabular-nums font-medium">{formatMoney(sections.worksSubtotal)}</dd>
            </div>
          ) : null}
          {sections.materials.length > 0 ? (
            <div className="flex justify-between py-0.5">
              <dt style={{ color: MUTED }}>{t("invoices.document.materialsSubtotal")}</dt>
              <dd className="tabular-nums font-medium">{formatMoney(sections.materialsSubtotal)}</dd>
            </div>
          ) : null}
          <div className="print-exact mt-1.5 flex items-center justify-between rounded-md px-3 py-2" style={{ background: PRIMARY, color: "#fff" }}>
            <dt className="text-xs font-bold">{invoice.status === "paid" ? t("invoices.document.totalPaid") : t("invoices.document.amountDue")}</dt>
            <dd className="text-base font-bold tabular-nums">{formatMoney(invoice.status === "paid" ? sections.grandTotal : amountDue)}</dd>
          </div>
        </dl>
      </section>

      {/* Payment details */}
      {(supplier.iban || supplier.bankName || supplier.bankCode || supplier.extraInfo) ? (
        <section className="print-exact mt-4 break-inside-avoid rounded-md px-3 py-2" style={{ background: TINT }}>
          <h2 className="text-[10px] font-bold uppercase tracking-wide" style={{ color: PRIMARY_DARK }}>{t("invoices.document.paymentDetails")}</h2>
          <div className="mt-1">
            <SupplierLine label={t("invoices.document.iban")} value={supplier.iban} />
            <SupplierLine label={t("invoices.document.bank")} value={supplier.bankName} />
            <SupplierLine label={t("invoices.document.bankCode")} value={supplier.bankCode} />
            <SupplierLine label={t("invoices.document.beneficiary")} value={supplier.name} />
          </div>
          {supplier.extraInfo ? <p className="mt-1 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{supplier.extraInfo}</p> : null}
          <p className="mt-1 text-xs" style={{ color: MUTED }}>{t("invoices.document.paymentReference", { number: invoice.invoiceNumber })}</p>
        </section>
      ) : null}

      <footer className="mt-4 break-inside-avoid border-t border-[#e5e7eb] pt-2 text-[10px] leading-snug" style={{ color: MUTED }}>
        <p>{supplier.name || companyName}{supplier.email ? ` · ${supplier.email}` : ""}{supplier.iban ? ` · IBAN ${supplier.iban}` : ""}</p>
        <p>{t("invoices.document.notFiscal")}</p>
      </footer>
    </article>
  );
}
