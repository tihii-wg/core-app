/** Pure helpers for print templates (variable substitution + HTML sanitising). No DOM side effects except `sanitizeTemplateHtml`. */

export type PrintVariables = {
  orderNumber: string;
  clientName: string;
  status: string;
  currency: string;
};

const BLOCKED_TAGS = ["script", "iframe", "object", "embed", "link", "meta", "base", "form", "style"];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces the minimal RO variable set. Values are HTML-escaped; unknown `#...` tokens are left untouched. */
export function applyPrintVariables(html: string, variables: PrintVariables) {
  const map: Record<string, string> = {
    "#ЗАКАЗ-НОМЕР": variables.orderNumber,
    "#КЛИЕНТ-ИМЯ": variables.clientName,
    "#СТАТУС": variables.status,
    "#ВАЛЮТА": variables.currency,
  };
  let result = html;
  for (const [token, value] of Object.entries(map)) {
    result = result.split(token).join(escapeHtml(value));
  }
  return result;
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
export function buildPrintDocument(bodyHtml: string, title = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_PAGE_STYLE}</style></head><body>${sanitizeTemplateHtml(bodyHtml)}</body></html>`;
}
