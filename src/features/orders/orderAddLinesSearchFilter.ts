import type { InventoryItem, Service } from "../../lib/types";

export const ORDER_ADD_LINES_SEARCH_GROUP_LIMIT = 8;

/** Whitespace-separated tokens; empty string → no tokens (match everything). */
export function tokenizeAddLinesQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Case-insensitive token AND over a haystack; collapses extra spaces in the haystack. */
export function matchesAddLinesTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalized = haystack.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return tokens.every((token) => normalized.includes(token));
}

export function filterServicesForAddLinesSearch(services: readonly Service[], query: string): Service[] {
  const tokens = tokenizeAddLinesQuery(query);
  return services.filter(
    (service) =>
      service.status === "active" &&
      matchesAddLinesTokens(`${service.service_name ?? ""} ${service.category ?? ""}`, tokens),
  );
}

export function filterInventoryForAddLinesSearch(items: readonly InventoryItem[], query: string): InventoryItem[] {
  const tokens = tokenizeAddLinesQuery(query);
  return items.filter(
    (item) =>
      item.isActive &&
      matchesAddLinesTokens(
        `${item.name ?? ""} ${item.sku ?? ""} ${item.category ?? ""} ${item.supplier ?? ""}`,
        tokens,
      ),
  );
}

export function takeAddLinesSearchGroup<T>(items: readonly T[], expanded: boolean, limit = ORDER_ADD_LINES_SEARCH_GROUP_LIMIT): {
  visible: T[];
  hiddenCount: number;
} {
  if (expanded || items.length <= limit) {
    return { visible: [...items], hiddenCount: 0 };
  }
  return { visible: items.slice(0, limit), hiddenCount: items.length - limit };
}
