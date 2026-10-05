import { Building2, ChevronDown, Trash2 } from "lucide-react";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { useWorkspaceAvatar } from "../features/workspaces/useWorkspaceAvatar";
import { Button } from "./Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { useSetActiveWorkspace } from "../features/workspaces/useSetActiveWorkspace";
import { useDeleteWorkspace } from "../features/workspaces/useDeleteWorkspace";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CreateMadalProps } from "../lib/types";
import { canManageWorkspace } from "../features/workspaces/workspaceRoles";

export default function CompanySelector({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { updateWorkspace } = useSetActiveWorkspace();
  const { deleteWorkspace } = useDeleteWorkspace();
  const { workspaces: data } = useGetWorkspaces();
  const { data: profile } = useGetProfile();

  const workspaces = (data ?? []).flatMap((item) => {
    const workspace = item.workspaces;
    if (!workspace) return [];
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    return entries.map((entry) => ({ ...entry, canDelete: canManageWorkspace(item.role) }));
  });

  const currentWorkspace = workspaces?.find((item) => item.id === profile?.active_workspace_id);

  const currentWorkspaceId = location.pathname.split("/")[2];

  function updateWorkspaceHandler(id: string) {
    updateWorkspace(id);
  }

  function deleteWorkspaceHandler(id: string) {
    deleteWorkspace(id);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" title={currentWorkspace?.name} className="flex h-9 items-center gap-2 px-2 text-[13px] text-foreground sm:px-2.5">
          <Building2 aria-hidden="true" className="text-subtle-foreground" />
          <span className="sr-only sm:not-sr-only sm:max-w-36 sm:truncate">{currentWorkspace?.name}</span>
          <ChevronDown aria-hidden="true" className="hidden size-3.5 text-subtle-foreground sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("nav.workspace.switchCompany")}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {workspaces?.map((w) => (
          <DropdownMenuItem key={w.id} className={`cursor-pointer ${w.id === currentWorkspaceId ? "bg-accent font-medium text-accent-foreground" : ""}`}>
            <CompanyMark id={w.id} name={w.name} avatarPath={w.avatar_path} />
            <span className="min-w-0 flex-1 truncate" onClick={() => updateWorkspaceHandler(w.id)}>
              {w.name}
            </span>

            {w.canDelete && (
              <span
                className="rounded p-0.5 text-subtle-foreground hover:text-destructive"
                aria-label={t("nav.workspace.deleteCompany", { name: w.name })}
                onClick={() => {
                  deleteWorkspaceHandler(w.id);
                }}
              >
                <Trash2 />
              </span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => {
            setCreateModalOpen(true);
          }}
        >
          <span className="text-primary">{t("nav.workspace.addCompany")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompanyMark({ id, name, avatarPath }: { id?: string; name?: string | null; avatarPath?: string | null }) {
  const { data: imageUrl } = useWorkspaceAvatar(id, avatarPath);
  if (!name) return <Building2 className="h-4 w-4 text-muted-foreground" />;
  return <WorkspaceAvatar name={name} imageUrl={imageUrl} size="sm" />;
}
