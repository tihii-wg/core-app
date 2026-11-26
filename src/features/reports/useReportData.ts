import { useQuery } from "@tanstack/react-query";
import supabase from "../../services/supabase";
import { getOrders } from "../../services/apiOrders";
import { getReportPayments, PaymentsUnavailableError } from "../../services/apiPayments";
import { getClientsCreatedBetween } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useRealtimeHotQueryOptions } from "../realtime/useRealtimeHotQueryOptions";
import { reportDataWindow, type ReportPeriod } from "./reportStats";
import type { Client, Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";

const EMPTY_ORDERS: Order[] = [];
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_PAYMENTS: LedgerPayment[] = [];

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Data of one report period, read for that period only (previous period → end), in one parallel wave:
 * orders created / changed in the window plus the open ones (open / overdue snapshot), the ledger rows paid in the
 * window or belonging to those orders, and the clients created in the window. Keys live under the usual
 * ["orders" | "payments" | "clients", workspaceId] prefixes, so mutations and realtime refresh them as before.
 */
export function useReportData(
  period: Pick<ReportPeriod, "start" | "end" | "previousStart">,
  { orders: needsOrders = true, clients: needsClients = true, payments: needsPayments = needsOrders, enabled = true }: { orders?: boolean; clients?: boolean; payments?: boolean; enabled?: boolean } = {},
) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  const dataWindow = reportDataWindow(period);
  const active = Boolean(workspaceId) && enabled;

  const ordersQuery = useQuery({
    queryKey: ["orders", workspaceId, "report", dataWindow.from, dataWindow.to, dataWindow.activityFrom],
    queryFn: () => getOrders(workspaceId, "", "order", { reportWindow: dataWindow }),
    enabled: active && needsOrders,
    ...hot,
  });
  const paymentsQuery = useQuery({
    queryKey: ["payments", workspaceId, "report", dataWindow.from, dataWindow.to],
    queryFn: () => getReportPayments(workspaceId, dataWindow),
    enabled: active && needsPayments,
    ...hot,
    retry: (failureCount, error) => !(error instanceof PaymentsUnavailableError) && failureCount < 3,
  });
  // Client "created" dates are compared as local calendar days: read one extra day on each side, filter exactly in JS.
  const clientsWindow = { from: shiftDateKey(dataWindow.from, -1), to: shiftDateKey(dataWindow.to, 1) };
  const clientsQuery = useQuery({
    queryKey: ["clients", workspaceId, "report", clientsWindow.from, clientsWindow.to],
    queryFn: () => getClientsCreatedBetween(workspaceId, clientsWindow),
    enabled: active && needsClients,
  });

  return { ordersQuery, paymentsQuery, clientsQuery,
    orders: ordersQuery.data ?? EMPTY_ORDERS,
    payments: paymentsQuery.data ?? EMPTY_PAYMENTS,
    clients: clientsQuery.data ?? EMPTY_CLIENTS,
    paymentsUnavailable: paymentsQuery.error instanceof PaymentsUnavailableError,
  };
}

/** Calendar years that have orders, newest first (at least the current year) — the year filter of Reports / Finance. */
export function useReportYears() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: firstYear } = useQuery({
    queryKey: ["orders", workspaceId, "first-year"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at")
        .eq("workspace_id", workspaceId as string)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      const value = (data?.[0] as { created_at?: string } | undefined)?.created_at;
      const year = value ? Number(value.slice(0, 4)) : NaN;
      return Number.isFinite(year) ? year : null;
    },
    enabled: Boolean(workspaceId),
    staleTime: 60 * 60_000,
  });
  const current = new Date().getFullYear();
  const oldest = Math.min(current, firstYear ?? current);
  const years: number[] = [];
  for (let year = current; year >= oldest && years.length < 30; year -= 1) years.push(year);
  return years;
}
