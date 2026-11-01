import i18n from "../../i18n";
import type { ActivityLogEntry } from "../../services/apiActivityLog";
import type { Order } from "../../lib/types";
import { ordersByStatusSection, reportCsv, summaryKpis, type ReportSection } from "./quickReports";
import type { ReportPeriod } from "./reportStats";

/** Cells starting with these characters can run as formulas in spreadsheet apps (CSV injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapes one CSV cell: neutralises formula prefixes and quotes values containing separators/quotes/newlines. */
export function csvEscape(value: string | number | null | undefined) {
  if (value == null) return "";
  let text = String(value);
  // Numbers (including negatives) are data, not formulas; only guard free text.
  if (typeof value === "string" && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds CSV text (CRLF line endings, as the existing report exports do). Pure. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return [headers, ...rows].map((line) => line.map(csvEscape).join(",")).join("\r\n");
}

function activityHeaders() {
  return [
    i18n.t("reports.activity.columns.when"),
    i18n.t("reports.activity.columns.actor"),
    i18n.t("reports.activity.columns.entity"),
    i18n.t("reports.activity.columns.event"),
  ];
}

/** Activity log rows as CSV. `formatDateTime` receives valid dates only; invalid timestamps export as an empty cell. */
export function activityLogCsv(entries: ActivityLogEntry[], formatDateTime: (date: Date) => string) {
  return toCsv(
    activityHeaders(),
    entries.map((entry) => {
      const date = entry.createdAt ? new Date(entry.createdAt) : null;
      return [
        date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : "",
        entry.actorName ?? i18n.t("reports.activity.system"),
        entry.entityType,
        entry.event,
      ];
    }),
  );
}

/** Activity log as a report table section, so it can ride along in the PDF/CSV export dialog. */
export function activityLogSection(entries: ActivityLogEntry[], formatDateTime: (date: Date) => string): ReportSection {
  return {
    kind: "table",
    title: i18n.t("reports.activity.title"),
    description: i18n.t("reports.activity.exportDescription", { count: entries.length }),
    columns: [
      { key: "when", header: i18n.t("reports.activity.columns.when") },
      { key: "actor", header: i18n.t("reports.activity.columns.actor") },
      { key: "entity", header: i18n.t("reports.activity.columns.entity") },
      { key: "event", header: i18n.t("reports.activity.columns.event") },
    ],
    rows: entries.map((entry) => {
      const date = entry.createdAt ? new Date(entry.createdAt) : null;
      return {
        when: date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : null,
        actor: entry.actorName ?? i18n.t("reports.activity.system"),
        entity: entry.entityType,
        event: entry.event,
      };
    }),
  };
}

/** Orders summary for a period: key metrics plus orders-by-status, in the shared report CSV layout. */
export function ordersSummaryCsv(
  orders: Order[],
  clientCreatedDates: string[],
  period: ReportPeriod,
  meta: { title: string; workspace: string; period: string; generated: string },
  industrySlug?: string | null,
) {
  return reportCsv(meta, {
    kpis: summaryKpis(orders, clientCreatedDates, period),
    sections: [ordersByStatusSection(orders, period, industrySlug)],
  });
}
