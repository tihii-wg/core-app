import type { AccessLabel, SubscriptionStatus } from "./types";

/** Mirrors Core App `hasSubscriptionWriteEntitlement` so the admin shows what tenants experience. */
export function accessLabel(status: SubscriptionStatus | null, expiresAt: string | null, now = new Date()): AccessLabel {
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) return "read-only";
  if (status === "active") return "writable";
  if (status === "trial") return expires != null ? "writable" : "read-only";
  return "read-only";
}

export function daysUntil(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** Adds months to a base date (from max(now, current expiry)) — used by quick extend buttons. */
export function extendFrom(currentExpiry: string | null, months: number, now = new Date()): Date {
  const current = currentExpiry ? new Date(currentExpiry) : null;
  const base = current && !Number.isNaN(current.getTime()) && current > now ? new Date(current) : new Date(now);
  base.setMonth(base.getMonth() + months);
  return base;
}
