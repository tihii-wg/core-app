import { useTranslation } from "react-i18next";
import { currentIntlLocale } from "../../i18n";
import type { QuickReportModel, ReportColumn, ReportFormat, ReportRow, ReportSection } from "./quickReports";

type Formatters = {
  formatMoney: (value: number) => string;
  formatDate: (value: string) => string;
};

type ReportDocumentProps = Formatters & {
  title: string;
  description: string;
  workspaceName: string;
  periodLabel: string;
  generatedLabel: string;
  model: QuickReportModel;
};

const numericFormats = new Set<ReportFormat>(["number", "money", "percent", "share"]);

function formatPercent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function formatValue(value: string | number | null | undefined, format: ReportFormat, { formatMoney, formatDate }: Formatters) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    if (format === "money") return formatMoney(value);
    if (format === "percent" || format === "share") return formatPercent(value);
    return value.toLocaleString(currentIntlLocale());
  }
  return format === "date" ? formatDate(value) : value;
}

function NoData({ description }: { description?: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-[#d1d5db] px-6 py-8 text-center">
      <p className="font-medium text-[#1f2933]">{t("reports.document.noData")}</p>
      {description && <p className="mt-1 text-sm text-[#6b7280]">{description}</p>}
    </div>
  );
}

function Cell({ column, value, formatters }: { column: ReportColumn; value: string | number | null | undefined; formatters: Formatters }) {
  const format = column.format ?? "text";
  const text = formatValue(value, format, formatters);

  if (format === "share" && typeof value === "number") {
    return (
      <span className="inline-flex items-center justify-end gap-2">
        <span className="print-exact h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e7eb]" aria-hidden="true">
          <span className="block h-full rounded-full bg-[#1a6de0]" style={{ width: `${Math.min(value, 100)}%` }} />
        </span>
        {text}
      </span>
    );
  }
  return <>{text}</>;
}

function SecondaryValues({ column, row, formatters }: { column: ReportColumn; row: ReportRow; formatters: Formatters }) {
  const values = (column.secondary ?? []).filter((secondary) => row[secondary.key] != null && row[secondary.key] !== "");
  if (values.length === 0) return null;

  return (
    <span className="mt-0.5 block text-xs text-[#6b7280]">
      {values.map((secondary, index) => (
        <span key={secondary.key}>
          {index > 0 && " · "}
          <span>{formatValue(row[secondary.key], secondary.format ?? "text", formatters)}</span>
        </span>
      ))}
    </span>
  );
}

function SectionTable({ section, formatters }: { section: Extract<ReportSection, { kind: "table" }>; formatters: Formatters }) {
  if (section.rows.length === 0) return <NoData />;

  const isNumeric = (column: ReportColumn) => numericFormats.has(column.format ?? "text");
  const cellClass = (column: ReportColumn) => `px-2.5 py-2 align-top text-[#1f2933] ${isNumeric(column) ? "whitespace-nowrap text-right tabular-nums" : "text-left [overflow-wrap:anywhere]"}`;

  return (
    <div className="max-w-full overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="print-exact border-b border-[#d1d5db] bg-[#f3f4f6]">
            {section.columns.map((column) => (
              <th key={column.key} scope="col" className={`px-2.5 py-2 align-bottom text-xs font-semibold uppercase tracking-wide text-[#4b5563] ${isNumeric(column) ? "text-right" : "text-left"}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, index) => (
            <tr key={index} className="break-inside-avoid border-b border-[#eef0f2]">
              {section.columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  <Cell column={column} value={row[column.key]} formatters={formatters} />
                  <SecondaryValues column={column} row={row} formatters={formatters} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {section.totals && (
          <tfoot>
            <tr className="break-inside-avoid border-t-2 border-[#1f2933] font-semibold">
              {section.columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {section.totals?.[column.key] == null ? "" : <Cell column={column} value={section.totals[column.key]} formatters={formatters} />}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function ReportDocument({ title, description, workspaceName, periodLabel, generatedLabel, model, formatMoney, formatDate }: ReportDocumentProps) {
  const { t } = useTranslation();
  const formatters = { formatMoney, formatDate };

  return (
    <article aria-label={title} className="mx-auto w-full max-w-[210mm] rounded-md border border-[#e5e7eb] bg-white p-6 text-[#1f2933] shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="print-exact flex flex-col gap-4 border-b-2 border-[#1a6de0] pb-5 sm:flex-row sm:items-end sm:justify-between print:flex-row print:items-end print:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1a6de0]">{workspaceName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#111827]">{title}</h1>
          <p className="text-sm text-[#6b7280]">{description}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm sm:text-right print:text-right">
          <dt className="text-[#6b7280]">{t("reports.document.period")}</dt>
          <dd className="whitespace-nowrap font-medium">{periodLabel}</dd>
          <dt className="text-[#6b7280]">{t("reports.document.generated")}</dt>
          <dd className="whitespace-nowrap font-medium">{generatedLabel}</dd>
        </dl>
      </header>

      {model.kpis.length > 0 && (
        <section aria-label={t("reports.document.keyFigures")} className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 break-inside-avoid">
          {model.kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0 rounded-md border border-[#e5e7eb] p-3 [overflow-wrap:anywhere]">
              <p className="text-xs font-medium uppercase tracking-wide text-[#6b7280]">{kpi.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[#111827]">{formatValue(kpi.value, kpi.format, formatters)}</p>
              {kpi.hint && <p className="mt-0.5 text-xs text-[#6b7280]">{kpi.hint}</p>}
            </div>
          ))}
        </section>
      )}

      {model.sections.map((section) => (
        <section key={section.title} aria-label={section.title} className="mt-8">
          <h2 className="break-after-avoid border-b border-[#e5e7eb] pb-1.5 text-base font-semibold text-[#111827]">{section.title}</h2>
          {section.kind === "table" && section.description && <p className="mt-1 text-xs text-[#6b7280]">{section.description}</p>}
          <div className="mt-3">{section.kind === "unavailable" ? <NoData description={section.description} /> : <SectionTable section={section} formatters={formatters} />}</div>
        </section>
      ))}

      <footer className="mt-10 border-t border-[#e5e7eb] pt-3 text-xs text-[#6b7280]">
        {t("reports.document.footer", { workspace: workspaceName, generated: generatedLabel })}
      </footer>
    </article>
  );
}
