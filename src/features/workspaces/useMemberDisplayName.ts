import { useCallback, useMemo } from "react";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetWorkspaceMembers } from "./useGetWorkspaceMembers";

type MemberLike = { userId: string; fullName: string | null; email: string | null };
type EmployeeLike = { name: string; email?: string | null; profile_id?: string | null; status?: string };

export type MemberNameIndex = {
  byUserId: Map<string, string>;
  byEmail: Map<string, string>;
};

const clean = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value.trim() : "");

/**
 * Display names of workspace people: the member's own profile name first, then the name of the employee card
 * linked to that user (active cards win over inactive ones). Indexed by user id and by email, so rows that only
 * stored an email (older history entries) also resolve to a name. Pure.
 */
export function buildMemberNameIndex(members: readonly MemberLike[], employees: readonly EmployeeLike[]): MemberNameIndex {
  const byUserId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const employeeByUser = new Map<string, string>();
  for (const employee of [...employees].sort((a, b) => Number(a.status === "active") - Number(b.status === "active"))) {
    const name = clean(employee.name);
    if (!name) continue;
    if (employee.profile_id) employeeByUser.set(employee.profile_id, name);
    const email = clean(employee.email).toLowerCase();
    if (email) byEmail.set(email, name);
  }
  for (const member of members) {
    const name = clean(member.fullName) || employeeByUser.get(member.userId) || "";
    if (!name) continue;
    byUserId.set(member.userId, name);
    const email = clean(member.email).toLowerCase();
    if (email) byEmail.set(email, name);
  }
  for (const [userId, name] of employeeByUser) if (!byUserId.has(userId)) byUserId.set(userId, name);
  return { byUserId, byEmail };
}

/** Name for a history / comment author: by user id, else by a stored email, else the stored label as is. Pure. */
export function resolveMemberDisplayName(
  index: MemberNameIndex,
  userId: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const byId = userId ? index.byUserId.get(userId) : undefined;
  if (byId) return byId;
  const label = clean(stored);
  if (!label) return null;
  return index.byEmail.get(label.toLowerCase()) ?? label;
}

/** Hook: `(userId, storedName) => display name` — shows people by name instead of their email. */
export function useMemberDisplayName() {
  const { members } = useGetWorkspaceMembers();
  const { employees } = useGetEmployees();
  const index = useMemo(() => buildMemberNameIndex(members ?? [], employees ?? []), [members, employees]);
  return useCallback(
    (userId: string | null | undefined, stored: string | null | undefined) => resolveMemberDisplayName(index, userId, stored),
    [index],
  );
}
