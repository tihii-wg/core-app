import type { AdminWorkspaceRow } from "./types";

/**
 * Clearly labeled DEMO fixtures for UI walkthrough only.
 * These are fictional workspaces — not live subscription data.
 */
export const DEMO_WORKSPACES: AdminWorkspaceRow[] = [
  {
    id: "demo-ws-1001",
    name: "North Garage Demo Co.",
    ownerName: "Alex Owner",
    ownerEmail: "alex.owner@example.com",
    planLabel: "professional",
    subscriptionStatus: "active",
    subscriptionStartedAt: "2025-11-01T00:00:00.000Z",
    subscriptionExpiresAt: "2026-11-01T00:00:00.000Z",
    employeeCount: 8,
    orderCount: 142,
    accessLabel: "writable",
  },
  {
    id: "demo-ws-1002",
    name: "Rapid Fix Demo SRL",
    ownerName: "Maria Demo",
    ownerEmail: "maria.demo@example.org",
    planLabel: "starter",
    subscriptionStatus: "trial",
    subscriptionStartedAt: "2026-03-01T00:00:00.000Z",
    subscriptionExpiresAt: "2026-04-01T00:00:00.000Z",
    employeeCount: 3,
    orderCount: 19,
    accessLabel: "writable",
  },
  {
    id: "demo-ws-1003",
    name: "City Motors Demo",
    ownerName: "Ion Sample",
    ownerEmail: "ion.sample@example.com",
    planLabel: "professional",
    subscriptionStatus: "expired",
    subscriptionStartedAt: "2024-09-15T00:00:00.000Z",
    subscriptionExpiresAt: "2025-09-15T00:00:00.000Z",
    employeeCount: 12,
    orderCount: 510,
    accessLabel: "read-only",
  },
  {
    id: "demo-ws-1004",
    name: "Suspended Demo Workshop",
    ownerName: "Elena Example",
    ownerEmail: "elena.example@example.org",
    planLabel: "enterprise",
    subscriptionStatus: "suspended",
    subscriptionStartedAt: "2025-01-10T00:00:00.000Z",
    subscriptionExpiresAt: "2026-01-10T00:00:00.000Z",
    employeeCount: 21,
    orderCount: 880,
    accessLabel: "read-only",
  },
  {
    id: "demo-ws-1005",
    name: "Cancelled Demo Autoshop",
    ownerName: "Vlad Example",
    ownerEmail: "vlad.example@example.com",
    planLabel: "starter",
    subscriptionStatus: "cancelled",
    subscriptionStartedAt: "2024-02-01T00:00:00.000Z",
    subscriptionExpiresAt: "2025-02-01T00:00:00.000Z",
    employeeCount: 2,
    orderCount: 44,
    accessLabel: "read-only",
  },
];

export function getDemoWorkspace(id: string) {
  return DEMO_WORKSPACES.find((row) => row.id === id) ?? null;
}

export function summarizeDemoWorkspaces(rows: AdminWorkspaceRow[]) {
  const byStatus = Object.fromEntries(
    ["trial", "active", "expired", "suspended", "cancelled"].map((status) => [
      status,
      rows.filter((row) => row.subscriptionStatus === status).length,
    ]),
  ) as Record<string, number>;

  const byPlan = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.planLabel] = (acc[row.planLabel] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalWorkspaces: rows.length,
    activeSubscriptions: byStatus.active ?? 0,
    expiredSubscriptions: byStatus.expired ?? 0,
    suspendedWorkspaces: byStatus.suspended ?? 0,
    byStatus,
    byPlan,
  };
}
