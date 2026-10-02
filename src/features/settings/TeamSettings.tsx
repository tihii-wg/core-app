import { useState, type FormEvent } from "react";
import { Users } from "lucide-react";
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
import type { WorkspaceTeamMember } from "../../services/apiWorkspaces";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function memberName(member: WorkspaceTeamMember) {
  return profileDisplayName(member.fullName, member.email ?? "Workspace member");
}

export function TeamSettings() {
  const { workspaceId, members = [], isLoading, error } = useGetWorkspaceMembers();
  const [addOpen, setAddOpen] = useState(false);
  const currentRole = members.find((member) => member.isCurrentUser)?.role ?? null;
  const canAdd = Boolean(workspaceId) && assignableWorkspaceRoles(currentRole).length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Manage your team and their permissions</CardDescription>
        </div>
        {canAdd && <Button onClick={() => setAddOpen(true)}>Invite Member</Button>}
      </CardHeader>
      <CardContent>
        <TeamMembersList workspaceId={workspaceId} members={members} isLoading={isLoading} error={error} currentRole={currentRole} />
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
};

export function TeamMembersList({ workspaceId, members, isLoading, error, currentRole }: TeamMembersListProps) {
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceTeamMember | null>(null);
  const { mutate: updateRole, isPending: updatingRole, variables: roleVariables } = useUpdateWorkspaceMemberRole();
  const { mutateAsync: removeMember, isPending: removing } = useRemoveWorkspaceMember();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading team members...</p>;
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Team members could not be loaded";
    return <p className="text-sm text-destructive">{message}</p>;
  }

  if (members.length === 0) {
    return <EmptyState icon={Users} title="No team members yet" description="Team members added to this workspace will appear here." />;
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
        const canManage = Boolean(workspaceId) && !member.isCurrentUser && canManageWorkspaceMember(currentRole, member.role);
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
              <StatusBadge variant="success" dot>Active</StatusBadge>
              {canManage && workspaceId ? (
                <>
                  <Select
                    value={member.role}
                    disabled={rowBusy || removing}
                    onValueChange={(role) => {
                      if (role !== member.role) updateRole({ workspaceId, userId: member.userId, role });
                    }}
                  >
                    <SelectTrigger className="w-[120px]" aria-label={`Role for ${name}`}>
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
                    Remove
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
            <DialogTitle>Remove team member?</DialogTitle>
            <DialogDescription>{memberToRemove ? `${memberName(memberToRemove)} will lose access to this workspace.` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMemberToRemove(null)} disabled={removing}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove().catch(() => undefined)} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
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
  const roles = assignableWorkspaceRoles(currentRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [formError, setFormError] = useState("");
  const { mutateAsync: addMember, isPending } = useAddWorkspaceMember();

  function close() {
    setEmail("");
    setRole("member");
    setFormError("");
    onOpenChange(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!emailPattern.test(value)) {
      setFormError("Enter a valid email address");
      return;
    }
    setFormError("");
    try {
      await addMember({ workspaceId, email: value, role });
      close();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not add the team member");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !isPending && close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>Give an existing Core App account access to this workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-member-email">Email</Label>
            <Input id="team-member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" disabled={isPending} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as WorkspaceRole)} disabled={isPending}>
              <SelectTrigger aria-label="Role">
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
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding..." : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
