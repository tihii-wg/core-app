import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { Avatar, AvatarFallback } from "../../ui/Avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { MemberRoleRecord } from "../../services/apiRoles";
import { profileDisplayName, profileInitials } from "../profiles/profileName";
import { PERMISSION_KEYS } from "../roles/permissions";
import { useGetRoles } from "../roles/useGetRoles";
import { useAssignMemberRole, useClearMemberRole, useGetMemberRoles } from "../roles/useMemberRoles";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { workspaceRoleLabel } from "../workspaces/workspaceRoles";

const NO_ROLE = "__none__";

function memberName(member: MemberRoleRecord) {
  return profileDisplayName(member.fullName, member.email ?? i18n.t("team.memberFallbackName"));
}

export function RolesSettings() {
  const { t } = useTranslation();
  const { data = [], isLoading, error } = useGetRoles();
  const { data: members = [], isLoading: membersLoading, error: membersError } = useGetMemberRoles();
  const assign = useAssignMemberRole();
  const clear = useClearMemberRole();
  const { can } = useMyPermissions();
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  // Legacy (no permissions loaded): owners and admins, matching crm_permitted_workspaces for users without a member role.
  const canAssign = withSubscriptionWriteAccess(
    can(PERMISSION_KEYS.settingsRoles, workspaceRole === "owner" || workspaceRole === "admin"),
    subscriptionAllowsWrite,
  );
  const busyUserId = assign.isPending ? assign.variables?.userId : clear.isPending ? clear.variables?.userId : undefined;

  function onRoleChange(member: MemberRoleRecord, value: string) {
    if (value === (member.roleId ?? NO_ROLE)) return;
    if (value === NO_ROLE) clear.mutate({ userId: member.userId });
    else assign.mutate({ userId: member.userId, roleId: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.roles.title")}</CardTitle>
        <CardDescription>{t("settings.roles.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.roles.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.roles.empty")}</p>
        ) : null}
        {data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((role) => (
              <li key={role.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{role.name}</p>
                  {role.description ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("settings.roles.permissionCount", { count: role.permissionCount })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {data.length > 0 ? (
          <div className="space-y-2.5">
            <div>
              <h3 className="text-sm font-medium text-foreground">{t("settings.roles.members.title")}</h3>
              <p className="text-xs text-muted-foreground">{t("settings.roles.members.description")}</p>
            </div>
            {membersLoading ? <p className="text-sm text-muted-foreground">{t("settings.roles.members.loading")}</p> : null}
            {membersError ? <p className="text-sm text-destructive">{membersError.message}</p> : null}
            {!membersLoading && !membersError && members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.roles.members.empty")}</p>
            ) : null}
            {members.map((member) => {
              const name = memberName(member);
              const isOwner = member.workspaceRole === "owner";
              const busy = busyUserId === member.userId;
              return (
                <div key={member.userId} className="flex flex-col gap-3 rounded-lg border border-border p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{profileInitials(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground" title={name}>{name}</p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {member.email ? `${member.email} · ` : ""}
                        {workspaceRoleLabel(member.workspaceRole)}
                      </p>
                    </div>
                  </div>
                  {isOwner ? (
                    <span className="text-sm text-muted-foreground">{t("settings.roles.members.ownerFullAccess")}</span>
                  ) : canAssign ? (
                    <Select value={member.roleId ?? NO_ROLE} disabled={busy} onValueChange={(value) => onRoleChange(member, value)}>
                      <SelectTrigger className="w-full sm:w-[220px]" aria-label={t("settings.roles.members.roleFor", { name })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROLE}>{t("settings.roles.members.noRole")}</SelectItem>
                        {data.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="inline-flex h-9 items-center rounded-md border border-border bg-muted/50 px-3 text-sm text-muted-foreground">
                      {member.roleName ?? t("settings.roles.members.noRole")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.roles.ownerNote")}</p>
      </CardContent>
    </Card>
  );
}
