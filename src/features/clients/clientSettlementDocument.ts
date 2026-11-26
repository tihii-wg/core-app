import i18n from "../../i18n";
import type { ClientSettlement, ClientSettlementRow } from "./clientSettlement";

/** Company header of a printed / e-mailed statement (legal entity first, then workspace settings). */
export type StatementCompany = {
  name: string;
  address: string;
  taxId: string;
  phone: string;
  email: string;
  logoUrl: string | null;
};

export type StatementInput = {
  company: StatementCompany;
  client: { name: string; phone?: string; email?: string };
  settlement: ClientSettlement;
  formatMoney: (value: number) => string;
  formatDate: (value: string) => string;
  /** Already formatted generation date/time. */
  generatedLabel: string;
};

/** Text mail clients cap the mailto URL; long statements list the first rows and point to the printed copy. */
const MAX_TEXT_ROWS = 40;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

/** Plate / device / services of an order line; services are shortened in the e-mail text (`maxServiceChars`). */
export function settlementRowDescription(row: Pick<ClientSettlementRow, "carNumber" | "device" | "service">, maxServiceChars = Infinity) {
  const service = row.service.trim();
  const shortService = service.length > maxServiceChars ? `${service.slice(0, maxServiceChars).trimEnd()}…` : service;
  return [row.carNumber.trim(), row.device.trim(), shortService].filter(Boolean).join(" · ");
}

function signedMoney(value: number, formatMoney: (value: number) => string) {
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
}

function balanceHint(value: number) {
  if (value < 0) return i18n.t("clients.settlement.document.balanceDebt");
  if (value > 0) return i18n.t("clients.settlement.document.balanceCredit");
  return i18n.t("clients.settlement.document.balanceSettled");
}

export function settlementStatementTitle(clientName: string) {
  return i18n.t("clients.settlement.document.title", { name: clientName });
}

/** Full A4 HTML document of the client statement (print / save as PDF, desktop and phone). */
export function settlementStatementHtml({ company, client, settlement, formatMoney, formatDate, generatedLabel }: StatementInput) {
  const t = (key: string, options?: Record<string, unknown>) => escapeHtml(String(i18n.t(key as never, options as never)));
  const companyLines = [
    company.address,
    company.taxId ? `${t("clients.settlement.document.taxId")}: ${company.taxId}` : "",
    [company.phone, company.email].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const clientLines = [client.phone, client.email].map((value) => (value ?? "").trim()).filter(Boolean);
  const rows = settlement.rows
    .map(
      (row, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td><b>${escapeHtml(row.orderNumber || "—")}</b>${settlementRowDescription(row) ? `<div class="muted">${escapeHtml(settlementRowDescription(row))}</div>` : ""}</td>
        <td class="date">${escapeHtml(row.date ? formatDate(row.date) : "—")}</td>
        <td class="money">${escapeHtml(formatMoney(row.total))}</td>
        <td class="money">${escapeHtml(formatMoney(row.paid))}</td>
        <td class="money"><b>${escapeHtml(formatMoney(row.remaining))}</b></td>
      </tr>`,
    )
    .join("");
  const final = settlement.finalBalance;
  const finalClass = final < 0 ? "debt" : final > 0 ? "credit" : "";
  const notes = [
    settlement.settledOrdersCount > 0 ? t("clients.settlement.settledExcluded", { count: settlement.settledOrdersCount }) : "",
    settlement.excludedCancelledCount > 0 ? t("clients.settlement.cancelledExcluded", { count: settlement.excludedCancelledCount }) : "",
  ].filter(Boolean);
  const title = escapeHtml(settlementStatementTitle(client.name));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; background: #fff; }
  @media print { body { padding: 0; } }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #111827; }
  .company { font-size: 12px; color: #374151; }
  .company b { display: block; font-size: 16px; color: #111827; margin-bottom: 2px; }
  header img { max-height: 56px; max-width: 160px; object-fit: contain; }
  h1 { font-size: 20px; margin: 18px 0 4px; }
  .meta { color: #4b5563; margin-bottom: 14px; }
  .client { margin: 0 0 16px; }
  .client b { font-size: 15px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
  .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; }
  .card span { display: block; font-size: 11px; color: #6b7280; }
  .card strong { font-size: 15px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #6b7280; border-bottom: 1px solid #9ca3af; }
  tfoot td { border-top: 1px solid #9ca3af; border-bottom: 0; font-weight: 600; }
  .money { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .num { width: 28px; color: #6b7280; }
  .date { white-space: nowrap; }
  .muted { color: #6b7280; font-size: 11px; }
  .final { margin-top: 16px; padding: 10px 12px; border: 2px solid #111827; border-radius: 6px; display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
  .final strong { font-size: 18px; font-variant-numeric: tabular-nums; }
  .debt { color: #b91c1c; } .credit { color: #047857; }
  .notes { margin-top: 12px; color: #6b7280; font-size: 11px; }
  .sign { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 12px; color: #374151; }
  .sign div { border-top: 1px solid #9ca3af; padding-top: 4px; }
  tr { page-break-inside: avoid; }
</style></head><body>
<header>
  <div class="company"><b>${escapeHtml(company.name)}</b>${companyLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
  ${company.logoUrl ? `<img src="${escapeHtml(company.logoUrl)}" alt="">` : ""}
</header>
<h1>${t("clients.settlement.document.heading")}</h1>
<div class="meta">${t("clients.settlement.document.generated", { date: generatedLabel })}</div>
<div class="client">${t("clients.settlement.document.client")}: <b>${escapeHtml(client.name)}</b>${clientLines.length ? `<div class="muted">${escapeHtml(clientLines.join(" · "))}</div>` : ""}</div>
<div class="cards">
  <div class="card"><span>${t("clients.settlement.existingBalance")}</span><strong>${escapeHtml(formatMoney(settlement.existingBalance))}</strong></div>
  <div class="card"><span>${t("clients.settlement.displayedOrderTotal")}</span><strong>${escapeHtml(formatMoney(settlement.displayedOrderTotal))}</strong></div>
  <div class="card"><span>${t("clients.settlement.columns.paid")}</span><strong>${escapeHtml(formatMoney(settlement.displayedPaid))}</strong></div>
  <div class="card"><span>${t("clients.settlement.totalOutstanding")}</span><strong>${escapeHtml(formatMoney(settlement.totalOutstanding))}</strong></div>
</div>
${
  settlement.rows.length === 0
    ? `<p>${t("clients.settlement.document.nothingDue")}</p>`
    : `<table>
  <thead><tr><th class="num">№</th><th>${t("clients.settlement.columns.order")}</th><th>${t("clients.settlement.columns.date")}</th><th class="money">${t("clients.settlement.columns.total")}</th><th class="money">${t("clients.settlement.columns.paid")}</th><th class="money">${t("clients.settlement.columns.remaining")}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td></td><td colspan="2">${t("clients.settlement.totalRow")}</td><td class="money">${escapeHtml(formatMoney(settlement.displayedOrderTotal))}</td><td class="money">${escapeHtml(formatMoney(settlement.displayedPaid))}</td><td class="money">${escapeHtml(formatMoney(settlement.totalOutstanding))}</td></tr></tfoot>
</table>`
}
<div class="final"><span>${t("clients.settlement.balance")}<div class="muted">${escapeHtml(balanceHint(final))}</div></span><strong class="${finalClass}">${escapeHtml(signedMoney(final, formatMoney))}</strong></div>
${notes.length ? `<div class="notes">${notes.map((note) => `<div>${note}</div>`).join("")}</div>` : ""}
<div class="sign"><div>${t("clients.settlement.document.signCompany")}</div><div>${t("clients.settlement.document.signClient")}</div></div>
</body></html>`;
}

/** Plain-text statement for the e-mail body / share sheet (works in every mail app, no attachment needed). */
export function settlementStatementText({ company, client, settlement, formatMoney, formatDate, generatedLabel }: StatementInput) {
  const tr = (key: string, options?: Record<string, unknown>) => String(i18n.t(key as never, options as never));
  const lines: string[] = [
    tr("clients.settlement.document.mailGreeting", { name: client.name }),
    "",
    tr("clients.settlement.document.mailIntro", { company: company.name, date: generatedLabel }),
    "",
    `${tr("clients.settlement.existingBalance")}: ${formatMoney(settlement.existingBalance)}`,
    `${tr("clients.settlement.displayedOrderTotal")}: ${formatMoney(settlement.displayedOrderTotal)}`,
    `${tr("clients.settlement.columns.paid")}: ${formatMoney(settlement.displayedPaid)}`,
    `${tr("clients.settlement.totalOutstanding")}: ${formatMoney(settlement.totalOutstanding)}`,
    `${tr("clients.settlement.balance")}: ${signedMoney(settlement.finalBalance, formatMoney)} (${balanceHint(settlement.finalBalance)})`,
    "",
  ];
  if (settlement.rows.length === 0) {
    lines.push(tr("clients.settlement.document.nothingDue"));
  } else {
    lines.push(`${tr("clients.settlement.document.ordersDue")}:`);
    settlement.rows.slice(0, MAX_TEXT_ROWS).forEach((row, index) => {
      const description = settlementRowDescription(row, 80);
      lines.push(
        `${index + 1}. ${row.orderNumber || "—"}${row.date ? ` (${formatDate(row.date)})` : ""}${description ? ` — ${description}` : ""}`,
        `   ${tr("clients.settlement.columns.total")}: ${formatMoney(row.total)}; ${tr("clients.settlement.columns.paid")}: ${formatMoney(row.paid)}; ${tr("clients.settlement.columns.remaining")}: ${formatMoney(row.remaining)}`,
      );
    });
    if (settlement.rows.length > MAX_TEXT_ROWS) {
      lines.push(tr("clients.settlement.document.moreRows", { count: settlement.rows.length - MAX_TEXT_ROWS }));
    }
    lines.push(
      `${tr("clients.settlement.totalRow")}: ${formatMoney(settlement.displayedOrderTotal)}; ${tr("clients.settlement.columns.paid")}: ${formatMoney(settlement.displayedPaid)}; ${tr("clients.settlement.columns.remaining")}: ${formatMoney(settlement.totalOutstanding)}`,
    );
  }
  lines.push("", tr("clients.settlement.document.mailClosing"), company.name);
  const contacts = [company.phone, company.email].filter(Boolean).join(" · ");
  if (contacts) lines.push(contacts);
  return lines.join("\n");
}
