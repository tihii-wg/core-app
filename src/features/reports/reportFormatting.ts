import { formatWorkspaceDate, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import type { ReportRange } from "./reportStats";

export const rangeLabels: Record<ReportRange, string> = {
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisYear: "This Year",
};

function formatTime(date: Date, timeZone: string) {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useReportFormatting() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { formatMoney } = useWorkspaceMoney();
  const dateFormat = workspace?.dateFormat ?? workspacePreferenceDefaults.dateFormat;
  const timeZone = workspace?.timezone ?? workspacePreferenceDefaults.timezone;

  return {
    workspaceId,
    workspaceName: workspace?.name || "Workspace",
    formatMoney: (value: number) => formatMoney(value),
    formatDate: (value: string) => formatWorkspaceDate(value, dateFormat, timeZone),
    formatDateTime: (date: Date) => `${formatWorkspaceDate(date.toISOString(), dateFormat, timeZone)} ${formatTime(date, timeZone)}`,
  };
}
