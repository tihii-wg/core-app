import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Share2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import i18n from "../../i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Avatar, AvatarFallback } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { EmptyState } from "../../ui/EmptyState";
import { StatusBadge } from "../../ui/StatusBadge";
import { profileDisplayName, profileInitials } from "../profiles/profileName";
import { useGetWorkspaceMembers } from "../workspaces/useGetWorkspaceMembers";
import { useAddWorkspaceMember, useRemoveWorkspaceMember, useUpdateWorkspaceMemberRole } from "../workspaces/useManageWorkspaceMembers";
import { assignableWorkspaceRoles, canManageWorkspaceMember, workspaceRoleLabel, type WorkspaceRole } from "../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { joinTeamRegisterUrl } from "../../services/apiAuth";
import { isAccountNotFoundError, type WorkspaceTeamMember } from "../../services/apiWorkspaces";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function memberName(member: WorkspaceTeamMember) {
  return profileDisplayName(member.fullName, member.email ?? i18n.t("team.memberFallbackName"));
}

export function TeamSettings() {
  const { t } = useTranslation();
  const { workspaceId, members = [], isLoading, error } = useGetWorkspaceMembers();
  const [addOpen, setAddOpen] = useState(false);
  const currentRole = members.find((member) => member.isCurrentUser)?.role ?? null;
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const canAdd =
    Boolean(workspaceId) &&
    withSubscriptionWriteAccess(assignableWorkspaceRoles(currentRole).length > 0, subscriptionAllowsWrite);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{t("team.title")}</CardTitle>
          <CardDescription>{t("team.description")}</CardDescription>
        </div>
        {canAdd && <Button onClick={() => setAddOpen(true)}>{t("team.inviteMember")}</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <SubscriptionReadOnlyNotice />
        <TeamMembersList
          workspaceId={workspaceId}
          members={members}
          isLoading={isLoading}
          error={error}
          currentRole={currentRole}
          subscriptionAllowsWrite={subscriptionAllowsWrite}
        />
      </CardContent>
      {canAdd && workspaceId && <AddTeamMemberDialog workspaceId={workspaceId} currentRole={currentRole} open={addOpen} onOpenChange={setAddOpen} />}
    </Card>
  );
}

type TeamMembersListProps = {
  workspaceId?: string;
  members: WorkspaceTeamMember[];
  isLoading: boolean;
  error: unknown;
  currentRole: string | null;
  subscriptionAllowsWrite?: boolean;
};

export function TeamMembersList({
  workspaceId,
  members,
  isLoading,
  error,
  currentRole,
  subscriptionAllowsWrite = true,
}: TeamMembersListProps) {
  const { t } = useTranslation();
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceTeamMember | null>(null);
  const { mutate: updateRole, isPending: updatingRole, variables: roleVariables } = useUpdateWorkspaceMemberRole();
  const { mutateAsync: removeMember, isPending: removing } = useRemoveWorkspaceMember();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("team.members.loading")}</p>;
  }

  if (error) {
    const message = error instanceof Error ? error.message : t("team.members.loadFailed");
    return <p className="text-sm text-destructive">{message}</p>;
  }

  if (members.length === 0) {
    return <EmptyState icon={Users} title={t("team.members.emptyTitle")} description={t("team.members.emptyDescription")} />;
  }

  async function confirmRemove() {
    if (!workspaceId || !memberToRemove) return;
    await removeMember({ workspaceId, userId: memberToRemove.userId });
    setMemberToRemove(null);
  }

  const assignable = assignableWorkspaceRoles(currentRole);

  return (
    <div className="space-y-2.5">
      {members.map((member) => {
        const name = memberName(member);
        const canManage = withSubscriptionWriteAccess(
          Boolean(workspaceId) && !member.isCurrentUser && canManageWorkspaceMember(currentRole, member.role),
          subscriptionAllowsWrite,
        );
        const rowBusy = updatingRole && roleVariables?.userId === member.userId;

        return (
          <div key={member.userId} className="flex flex-col gap-3 rounded-lg border border-border p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar>
                <AvatarFallback>{profileInitials(name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={name}>{name}</p>
                {member.email && <p className="truncate text-[13px] text-muted-foreground" title={member.email}>{member.email}</p>}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <StatusBadge variant="success" dot>{t("team.members.active")}</StatusBadge>
              {canManage && workspaceId ? (
                <>
                  <Select
                    value={member.role}
                    disabled={rowBusy || removing}
                    onValueChange={(role) => {
                      if (role !== member.role) updateRole({ workspaceId, userId: member.userId, role });
                    }}
                  >
                    <SelectTrigger className="w-[120px]" aria-label={t("team.members.roleFor", { name })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignable.map((role) => (
                        <SelectItem key={role} value={role}>
                          {workspaceRoleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" disabled={rowBusy || removing} onClick={() => setMemberToRemove(member)}>
                    {t("team.members.remove")}
                  </Button>
                </>
              ) : (
                <span className="inline-flex h-9 w-[120px] items-center rounded-md border border-border bg-muted/50 px-3 text-sm text-muted-foreground">{workspaceRoleLabel(member.role)}</span>
              )}
            </div>
          </div>
        );
      })}

      <Dialog open={memberToRemove !== null} onOpenChange={(open) => !removing && !open && setMemberToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.remove.title")}</DialogTitle>
            <DialogDescription>{memberToRemove ? t("team.remove.description", { name: memberName(memberToRemove) }) : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMemberToRemove(null)} disabled={removing}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove().catch(() => undefined)} disabled={removing}>
              {removing ? t("team.remove.removing") : t("team.remove.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AddTeamMemberDialogProps = {
  workspaceId: string;
  currentRole: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function AddTeamMemberDialog({ workspaceId, currentRole, open, onOpenChange }: AddTeamMemberDialogProps) {
  const { t } = useTranslation();
  const { locale = "en" } = useParams();
  const roles = assignableWorkspaceRoles(currentRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [formError, setFormError] = useState("");
  const [missingAccountEmail, setMissingAccountEmail] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { mutateAsync: addMember, isPending } = useAddWorkspaceMember();

  useEffect(() => {
    if (!linkCopied) return;
    const timer = window.setTimeout(() => setLinkCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [linkCopied]);

  function close() {
    setEmail("");
    setRole("member");
    setFormError("");
    setMissingAccountEmail(null);
    setLinkCopied(false);
    onOpenChange(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!emailPattern.test(value)) {
      setFormError(t("team.invite.invalidEmail"));
      setMissingAccountEmail(null);
      return;
    }
    setFormError("");
    setMissingAccountEmail(null);
    try {
      await addMember({ workspaceId, email: value, role });
      close();
    } catch (error) {
      if (isAccountNotFoundError(error)) {
        setMissingAccountEmail(value.toLowerCase());
        setFormError("");
        return;
      }
      setFormError(error instanceof Error ? error.message : t("team.toast.addFailed"));
    }
  }

  const registerLink = missingAccountEmail ? joinTeamRegisterUrl(locale, missingAccountEmail) : "";

  async function copyRegisterLink() {
    if (!registerLink) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(registerLink);
        setLinkCopied(true);
      }
    } catch {
      setLinkCopied(false);
    }
  }

  async function shareRegisterLink() {
    if (!registerLink) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: t("common.appName"),
          text: t("team.invite.registerLinkShareText", { email: missingAccountEmail }),
          url: registerLink,
        });
        return;
      } catch {
        // Fall through to copy.
      }
    }
    await copyRegisterLink();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !isPending && close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.invite.title")}</DialogTitle>
          <DialogDescription>{t("team.invite.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-member-email">{t("team.invite.emailLabel")}</Label>
            <Input
              id="team-member-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMissingAccountEmail(null);
              }}
              placeholder={t("team.invite.emailPlaceholder")}
              disabled={isPending}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>{t("team.invite.roleLabel")}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as WorkspaceRole)} disabled={isPending}>
              <SelectTrigger aria-label={t("team.invite.roleLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option} value={option}>
                    {workspaceRoleLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {missingAccountEmail ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3" data-testid="team-invite-register-link">
              <p className="text-sm text-foreground">{t("team.invite.notRegistered")}</p>
              <p className="text-[13px] text-muted-foreground">{t("team.invite.registerLinkHint")}</p>
              <div className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                {registerLink}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyRegisterLink()}>
                  {linkCopied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {linkCopied ? t("team.invite.linkCopied") : t("team.invite.copyLink")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void shareRegisterLink()}>
                  <Share2 className="size-4" aria-hidden="true" />
                  {t("team.invite.shareLink")}
                </Button>
              </div>
            </div>
          ) : null}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("team.invite.adding") : t("team.invite.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
