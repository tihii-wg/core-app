import type { OrderTeamMember, OrderTeamMemberInput, OrderTeamRole } from "../lib/types";
import { mergeOrderTeam, normalizeTeamRole, teamDiff } from "../features/orders/orderTeam";
import i18n from "../i18n";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined;

let orderEmployeesTableSupported: boolean | null = null;
let orderServiceTechnicianSupported: boolean | null = null;

/** Test hook: reset cached team / technician column support. */
export function resetOrderTeamSupport() {
  orderEmployeesTableSupported = null;
  orderServiceTechnicianSupported = null;
}

export function isOrderServiceTechnicianSupported() {
  return orderServiceTechnicianSupported !== false;
}

export function markOrderServiceTechnicianUnsupported() {
  orderServiceTechnicianSupported = false;
}

function isMissingColumnError(error: DbError) {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column|schema cache/i.test(error.message ?? "");
}

function isMissingTechnicianColumn(error: DbError) {
  return Boolean(error && isMissingColumnError(error) && /\btechnician_id\b/i.test(error.message ?? ""));
}

/** Map order_team:* DB exceptions to localized copy. Returns null when unrelated. */
export function mapOrderTeamDbError(error: {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}): Error | null {
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (/order_team:workspace_mismatch|order_team:technician_workspace_mismatch|order_team:default_technician_workspace_mismatch/i.test(blob)) {
    return new Error(i18n.t("orders.errors.teamWorkspace"));
  }
  return null;
}

type TeamRow = {
  order_id?: string;
  employee_id?: string;
  role?: string;
};

/**
 * Batched load of `order_employees` for many orders. Missing table → empty map (soft-fail).
 */
export async function loadOrderTeamsByOrderIds(
  workspaceId: string,
  orderIds: string[],
  employees: Array<{ id: string; name: string }>,
): Promise<Map<string, OrderTeamMember[]>> {
  const result = new Map<string, OrderTeamMember[]>();
  if (orderIds.length === 0 || orderEmployeesTableSupported === false) return result;

  const { data, error } = await supabase
    .from("order_employees")
    .select("order_id, employee_id, role")
    .eq("workspace_id", workspaceId)
    .in("order_id", orderIds);

  if (error) {
    if (isMissingTableError(error, "order_employees")) {
      orderEmployeesTableSupported = false;
      return result;
    }
    throw mapOrderTeamDbError(error) ?? new Error(error.message);
  }

  orderEmployeesTableSupported = true;
  const nameById = new Map(employees.map((employee) => [String(employee.id), employee.name?.trim() || String(employee.id)]));

  for (const row of (data ?? []) as TeamRow[]) {
    const orderId = typeof row.order_id === "string" ? row.order_id : "";
    const employeeId = typeof row.employee_id === "string" ? row.employee_id.trim() : "";
    if (!orderId || !employeeId) continue;
    const member: OrderTeamMember = {
      employeeId,
      name: nameById.get(employeeId) ?? employeeId,
      role: normalizeTeamRole(row.role),
    };
    const list = result.get(orderId) ?? [];
    list.push(member);
    result.set(orderId, list);
  }

  return result;
}

/**
 * Upsert/delete diff for `order_employees`. Soft-fails when the table is absent.
 * Always merges assignee + line technicians into the desired set before writing.
 */
export async function syncOrderEmployees(params: {
  workspaceId: string;
  orderId: string;
  assignedEmployeeId?: string | null;
  team?: OrderTeamMemberInput[];
  lineTechnicianIds?: Array<string | null | undefined>;
}): Promise<void> {
  if (orderEmployeesTableSupported === false) return;

  const desired = mergeOrderTeam({
    team: params.team,
    assignedEmployeeId: params.assignedEmployeeId,
    lineTechnicianIds: params.lineTechnicianIds,
  });

  const { data: existingRows, error: loadError } = await supabase
    .from("order_employees")
    .select("employee_id, role")
    .eq("workspace_id", params.workspaceId)
    .eq("order_id", params.orderId);

  if (loadError) {
    if (isMissingTableError(loadError, "order_employees")) {
      orderEmployeesTableSupported = false;
      return;
    }
    throw mapOrderTeamDbError(loadError) ?? new Error(loadError.message);
  }

  orderEmployeesTableSupported = true;
  const existing = ((existingRows ?? []) as Array<{ employee_id?: string; role?: string }>).map((row) => ({
    employeeId: String(row.employee_id ?? "").trim(),
    role: normalizeTeamRole(row.role) as OrderTeamRole,
  })).filter((row) => row.employeeId);

  const { toInsert, toUpdate, toDelete } = teamDiff(existing, desired);

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("order_employees")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .eq("order_id", params.orderId)
      .in("employee_id", toDelete);
    if (error) throw mapOrderTeamDbError(error) ?? new Error(error.message);
  }

  for (const member of toUpdate) {
    const { error } = await supabase
      .from("order_employees")
      .update({ role: member.role })
      .eq("workspace_id", params.workspaceId)
      .eq("order_id", params.orderId)
      .eq("employee_id", member.employeeId);
    if (error) throw mapOrderTeamDbError(error) ?? new Error(error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("order_employees").insert(
      toInsert.map((member) => ({
        workspace_id: params.workspaceId,
        order_id: params.orderId,
        employee_id: member.employeeId,
        role: member.role,
      })),
    );
    if (error) {
      if (isMissingTableError(error, "order_employees")) {
        orderEmployeesTableSupported = false;
        return;
      }
      throw mapOrderTeamDbError(error) ?? new Error(error.message);
    }
  }
}

/**
 * Resolve order ids where `employeeId` is on the team or a line performer.
 * Used only as the legacy employee-filter fallback when `orders.team_employee_ids` is absent.
 * Soft-fails to [] when tables/columns are missing.
 */
export async function resolveOrderIdsForEmployeeFilter(
  workspaceId: string,
  employeeId: string,
): Promise<{ teamOrderIds: string[]; lineOrderIds: string[] }> {
  const empty = { teamOrderIds: [] as string[], lineOrderIds: [] as string[] };
  const id = employeeId.trim();
  if (!id) return empty;

  const teamOrderIds: string[] = [];
  const lineOrderIds: string[] = [];

  if (orderEmployeesTableSupported !== false) {
    const { data, error } = await supabase
      .from("order_employees")
      .select("order_id")
      .eq("workspace_id", workspaceId)
      .eq("employee_id", id);
    if (error) {
      if (isMissingTableError(error, "order_employees")) {
        orderEmployeesTableSupported = false;
      } else {
        throw mapOrderTeamDbError(error) ?? new Error(error.message);
      }
    } else {
      orderEmployeesTableSupported = true;
      for (const row of (data ?? []) as Array<{ order_id?: string }>) {
        if (typeof row.order_id === "string" && row.order_id) teamOrderIds.push(row.order_id);
      }
    }
  }

  if (orderServiceTechnicianSupported !== false) {
    const { data, error } = await supabase
      .from("order_services")
      .select("order_id")
      .eq("technician_id", id);
    if (error) {
      if (isMissingTechnicianColumn(error) || isMissingTableError(error, "order_services")) {
        orderServiceTechnicianSupported = false;
      } else {
        throw mapOrderTeamDbError(error) ?? new Error(error.message);
      }
    } else {
      orderServiceTechnicianSupported = true;
      for (const row of (data ?? []) as Array<{ order_id?: string }>) {
        if (typeof row.order_id === "string" && row.order_id) lineOrderIds.push(row.order_id);
      }
    }
  }

  return { teamOrderIds, lineOrderIds };
}

export function technicianIdOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}
