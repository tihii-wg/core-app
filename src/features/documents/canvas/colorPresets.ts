import {
  INVOICE_PRINT_INK,
  INVOICE_PRINT_MUTED,
  INVOICE_PRINT_PRIMARY,
  INVOICE_PRINT_PRIMARY_DARK,
  INVOICE_PRINT_TINT,
  INVOICE_PRINT_TINT_STRONG,
  INVOICE_PRINT_ZEBRA,
} from "../../invoices/invoicePrintTheme";

/** ~24 preset colours including the original blue invoice palette. */
export const CANVAS_COLOR_PRESETS: readonly string[] = [
  INVOICE_PRINT_PRIMARY,
  INVOICE_PRINT_PRIMARY_DARK,
  INVOICE_PRINT_TINT,
  INVOICE_PRINT_TINT_STRONG,
  INVOICE_PRINT_ZEBRA,
  INVOICE_PRINT_INK,
  INVOICE_PRINT_MUTED,
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
  "#f5f5f4",
  "#e2e8f0",
  "#1e293b",
  "#0f172a",
];

const RECENT_KEY_PREFIX = "core-app.canvas.recentColors.";

export function loadRecentColors(workspaceId: string | undefined): string[] {
  if (!workspaceId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${RECENT_KEY_PREFIX}${workspaceId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && /^#[0-9a-fA-F]{6}$/.test(item)).slice(0, 12);
  } catch {
    return [];
  }
}

export function pushRecentColor(workspaceId: string | undefined, hex: string): string[] {
  if (!workspaceId || typeof window === "undefined") return [];
  const next = [hex, ...loadRecentColors(workspaceId).filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, 12);
  try {
    window.localStorage.setItem(`${RECENT_KEY_PREFIX}${workspaceId}`, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}
