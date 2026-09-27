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
import type { CreateMadalProps } from "../lib/types";

export default function CompanySelector({ setCreateModalOpen }: CreateMadalProps) {
  const location = useLocation();
  const { updateWorkspace } = useSetActiveWorkspace();
  const { deleteWorkspace } = useDeleteWorkspace();
  const { workspaces: data } = useGetWorkspaces();
  const { data: profile } = useGetProfile();

  const workspaces = (data ?? []).flatMap((item) => {
    const workspace = item.workspaces;
    if (!workspace) return [];
    return Array.isArray(workspace) ? workspace : [workspace];
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
        <Button variant="ghost" className="hidden sm:flex items-center gap-2 h-9 px-3 text-sm text-[#282e33]">
          <Building2 className="h-4 w-4 text-[#939699]" />
          <span className="max-w-30 truncate">{currentWorkspace?.name}</span>

          <ChevronDown className="h-4 w-4 text-[#939699]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Switch Company</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {workspaces?.map((w) => (
          <DropdownMenuItem key={w.id} className={`cursor-pointer ${w.id === currentWorkspaceId ? "text-[#1973e1] bg-[#1973e1]/10" : ""}`}>
            <CompanyMark id={w.id} name={w.name} avatarPath={w.avatar_path} />
            <span className="min-w-0 flex-1 truncate" onClick={() => updateWorkspaceHandler(w.id)}>
              {w.name}
            </span>

            <span
              onClick={() => {
                deleteWorkspaceHandler(w.id);
              }}
            >
              <Trash2 />
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => {
            setCreateModalOpen(true);
          }}
        >
          <span className="text-[#1973e1]">+ Add company</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompanyMark({ id, name, avatarPath }: { id?: string; name?: string | null; avatarPath?: string | null }) {
  const { data: imageUrl } = useWorkspaceAvatar(id, avatarPath);
  if (!name) return <Building2 className="h-4 w-4 text-[#939699]" />;
  return <WorkspaceAvatar name={name} imageUrl={imageUrl} size="sm" />;
}
