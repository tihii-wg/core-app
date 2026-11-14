import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetWorkspaceMembers } from "../workspaces/useGetWorkspaceMembers";

export type TeamPerson = { userId: string; name: string; isCurrentUser: boolean };

/** Workspace members as task assignees: display names + a lookup by auth user id. */
export function useTeamDirectory() {
  const { t } = useTranslation();
  const { members, isLoading } = useGetWorkspaceMembers();
  return useMemo(() => {
    const people: TeamPerson[] = (members ?? []).map((member) => ({
      userId: member.userId,
      name: member.fullName?.trim() || member.email?.trim() || t("stage9.tasks.unknownPerson"),
      isCurrentUser: member.isCurrentUser,
    }));
    people.sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser) || a.name.localeCompare(b.name));
    const byId = new Map(people.map((person) => [person.userId, person]));
    const nameOf = (userId: string | null | undefined) => {
      if (!userId) return null;
      const person = byId.get(userId);
      if (!person) return t("stage9.tasks.unknownPerson");
      return person.isCurrentUser ? t("stage9.tasks.me") : person.name;
    };
    const currentUserId = people.find((person) => person.isCurrentUser)?.userId ?? null;
    return { people, nameOf, currentUserId, isLoading };
  }, [members, isLoading, t]);
}
