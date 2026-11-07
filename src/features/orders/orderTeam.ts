import type { OrderTeamMemberInput, OrderTeamRole } from "../../lib/types";

export type { OrderTeamMemberInput, OrderTeamRole };

export function normalizeTeamRole(value: unknown): OrderTeamRole {
  return value === "lead" ? "lead" : "helper";
}

function cleanId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Builds the desired order team from explicit team rows, the main responsible employee and
 * service-line technicians. Deduplicated by employeeId; the assignee is always the lead and
 * comes first, the rest keep their original order (explicit team rows, then line technicians).
 */
export function mergeOrderTeam(params: {
  team?: OrderTeamMemberInput[];
  assignedEmployeeId?: string | null;
  lineTechnicianIds?: Array<string | null | undefined>;
}): OrderTeamMemberInput[] {
  const assigneeId = cleanId(params.assignedEmployeeId);
  const roles = new Map<string, OrderTeamRole>();

  const add = (rawId: string | null | undefined, role: OrderTeamRole) => {
    const employeeId = cleanId(rawId);
    if (!employeeId) return;
    const existing = roles.get(employeeId);
    roles.set(employeeId, existing === "lead" || role === "lead" ? "lead" : "helper");
  };

  for (const member of params.team ?? []) {
    add(member.employeeId, normalizeTeamRole(member.role));
  }
  for (const technicianId of params.lineTechnicianIds ?? []) {
    add(technicianId, "helper");
  }
  if (assigneeId) roles.set(assigneeId, "lead");

  const result: OrderTeamMemberInput[] = [];
  if (assigneeId) result.push({ employeeId: assigneeId, role: "lead" });
  for (const [employeeId, role] of roles) {
    if (employeeId === assigneeId) continue;
    result.push({ employeeId, role });
  }
  return result;
}

export function teamDiff(
  existing: Array<{ employeeId: string; role: OrderTeamRole }>,
  desired: OrderTeamMemberInput[],
): { toInsert: OrderTeamMemberInput[]; toUpdate: OrderTeamMemberInput[]; toDelete: string[] } {
  const existingRoles = new Map(existing.map((member) => [member.employeeId, member.role]));
  const desiredIds = new Set(desired.map((member) => member.employeeId));

  const toInsert: OrderTeamMemberInput[] = [];
  const toUpdate: OrderTeamMemberInput[] = [];
  for (const member of desired) {
    const currentRole = existingRoles.get(member.employeeId);
    if (currentRole === undefined) toInsert.push(member);
    else if (currentRole !== member.role) toUpdate.push(member);
  }

  const toDelete = existing.map((member) => member.employeeId).filter((employeeId) => !desiredIds.has(employeeId));
  return { toInsert, toUpdate, toDelete };
}

export function formatTeamNames(team: Array<{ name: string }>): string {
  return team
    .map((member) => member.name?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

export function teamAvatarSlice<T extends { name: string; employeeId: string }>(
  team: T[],
  maxVisible = 3,
): { visible: T[]; overflow: number } {
  const limit = Math.max(0, Math.floor(maxVisible));
  return {
    visible: team.slice(0, limit),
    overflow: Math.max(0, team.length - limit),
  };
}
