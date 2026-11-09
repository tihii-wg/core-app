/** Pure helpers for print templates (variable substitution + HTML sanitising). No DOM side effects except `sanitizeTemplateHtml`. */

import type { Order } from "../../lib/types";
import { formatWorkspaceDate } from "../../lib/workspaceFormat";
import {
  emptyPrintContext,
  escapeHtmlText,
  templateVariablesByTokenLength,
  type PrintContext,
  type TemplateVariableKind,
} from "./templateVariables";

export type PrintVariables = {
  orderNumber: string;
  clientName: string;
  status: string;
  currency: string;
};

export type ApplyTemplateOptions = {
  locale?: string;
  currency?: string;
  showCents?: boolean;
};

const BLOCKED_TAGS = ["script", "iframe", "object", "embed", "link", "meta", "base", "form", "style"];

function escapeHtml(value: string) {
  return escapeHtmlText(value);
}

function formatMoneyValue(value: number, currency: string, showCents: boolean, locale: string) {
  const digits = showCents ? 2 : 0;
  const amount = value.toLocaleString(locale || "en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const code = currency.trim();
  return code ? `${code} ${amount}` : amount;
}

function formatDateValue(value: string, ctx: PrintContext, kind: "date" | "datetime") {
  if (kind === "date") {
    return formatWorkspaceDate(value, ctx.dateFormat, ctx.timeZone);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = formatWorkspaceDate(value, ctx.dateFormat, ctx.timeZone);
  try {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: ctx.timeZone || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    return `${datePart} ${time}`;
  } catch {
    return datePart;
  }
}

function formatResolvedValue(
  raw: string | number | null,
  kind: TemplateVariableKind,
  ctx: PrintContext,
  options: Required<Pick<ApplyTemplateOptions, "currency" | "showCents" | "locale">>,
): string {
  if (raw == null) return "";
  if (kind === "html") return String(raw);
  if (kind === "money") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return "";
    return escapeHtml(formatMoneyValue(n, options.currency || ctx.currency, options.showCents, options.locale || ctx.locale));
  }
  if (kind === "date" || kind === "datetime") {
    const text = typeof raw === "string" ? raw : String(raw);
    if (!text) return "";
    return escapeHtml(formatDateValue(text, ctx, kind));
  }
  if (kind === "number") {
    return escapeHtml(String(raw));
  }
  return escapeHtml(String(raw));
}

/**
 * Replaces every registry token in `html`. Longer tokens first.
 * Text/money/date values are escaped; `html` kinds are inserted as generated markup.
 * Unknown `#TOKENS` are left untouched.
 */
export function applyTemplateVariables(html: string, ctx: PrintContext, options: ApplyTemplateOptions = {}) {
  const resolvedOptions = {
    locale: options.locale ?? ctx.locale ?? "en",
    currency: options.currency ?? ctx.currency ?? "",
    showCents: options.showCents !== false,
  };
  const ctxWithLocale: PrintContext = {
    ...ctx,
    locale: resolvedOptions.locale,
    currency: resolvedOptions.currency || ctx.currency,
  };

  let result = html;
  for (const variable of templateVariablesByTokenLength()) {
    if (!result.includes(variable.token)) continue;
    let replacement = "";
    try {
      replacement = formatResolvedValue(variable.resolve(ctxWithLocale), variable.kind, ctxWithLocale, resolvedOptions);
    } catch {
      replacement = "";
    }
    result = result.split(variable.token).join(replacement);
  }

  // Custom order fields: {{order.custom.<field_key>}}
  const custom = ctxWithLocale.customFieldValues ?? {};
  result = result.replace(/\{\{\s*order\.custom\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => custom[key] ?? "");

  // Field captions (built-in overrides + custom labels): {{order.label.<field_key>}}
  const labels = ctxWithLocale.orderFieldLabels ?? {};
  result = result.replace(/\{\{\s*order\.label\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => labels[key] ?? "");

  return result;
}

function legacyOrderStub(variables: PrintVariables): Order {
  return {
    id: "",
    clientId: "",
    clientName: variables.clientName,
    orderNumber: variables.orderNumber,
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    materials: [],
    description: "",
    status: "new",
    customStatus: { name: variables.status, color: null },
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
  };
}

/** Thin wrapper around the registry for the original four tokens. */
export function applyPrintVariables(html: string, variables: PrintVariables) {
  return applyTemplateVariables(
    html,
    emptyPrintContext({
      order: legacyOrderStub(variables),
      currency: variables.currency,
    }),
    { currency: variables.currency, showCents: true },
  );
}

/**
 * Strips active content (scripts, frames, inline handlers, javascript: URLs) from template HTML.
 * Falls back to fully escaped text when no DOM is available.
 */
export function sanitizeTemplateHtml(html: string) {
  if (typeof DOMParser === "undefined") return escapeHtml(html);
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const tag of BLOCKED_TAGS) {
    doc.querySelectorAll(tag).forEach((node) => node.remove());
  }
  doc.body.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href" || name === "action") && /^(javascript|data:text\/html|vbscript):/.test(value.replace(/\s+/g, ""))) {
        element.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

const PRINT_PAGE_STYLE =
  "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#111;margin:16px}";

/** Wraps sanitised fragment into a standalone document for an iframe `srcDoc`. */
export function buildPrintDocument(bodyHtml: string, title = "", extraCss = "") {
  const css = `${PRINT_PAGE_STYLE}${extraCss}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${sanitizeTemplateHtml(bodyHtml)}</body></html>`;
}
