import { Building2, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useGetProfiles } from "../features/profiles/useGetProfiles";
import { useSetActiveWorkspace } from "../features/workspaces/useSetActiveWorkspace";
import { useDeleteWorkspace } from "../features/workspaces/useDeleteWorkspace";
import { useLocation } from "react-router-dom";

export default function CompanySelector({ setCreateModalOpen }) {
  const location = useLocation();
  const { updateWorkspace } = useSetActiveWorkspace();
  const { deleteWorkspace } = useDeleteWorkspace();
  const { workspaces: data } = useGetWorkspaces();
  const { data: profile } = useGetProfiles();

  const workspaces = (data ?? []).flatMap((item) => item.workspaces ?? []);

  const currentWorkspace = workspaces?.find((item) => item.id === profile?.at(0).active_workspace_id);

  const currentWorkspaceId = location.pathname.split("/")[2];

  function updateWorkspaceHandler(id: string) {
    updateWorkspace(id);
  }

  function deleteWorkspaceHandler(id: string) {
    deleteWorkspace(id);
  }
  // console.log(profile)
  // console.log(currentWorkspaceId)

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
            <Building2 className="h-4 w-4 mr-2 text-[#939699]" />
            <span className="w-11" onClick={() => updateWorkspaceHandler(w.id)}>
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
