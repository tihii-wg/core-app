import { ChevronDown, LogOut, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "./Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { useUser } from "../features/auth/useUser";
import { useLogOut } from "../features/auth/useLogOut";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { profileDisplayName, profileInitials } from "../features/profiles/profileName";
import { profileSettingsPath } from "../features/settings/settingsTab";

export default function UserMenu() {
  const { logOut } = useLogOut();
  const { user } = useUser();
  const { data: profile } = useGetProfile();
  const navigate = useNavigate();
  const { locale = "en", workspaceId } = useParams();
  const userName = profileDisplayName(profile?.full_name, typeof user?.user_metadata?.ownerName === "string" ? user.user_metadata.ownerName : null);
  const email = profile?.email || user?.email;
  const profileWorkspaceId = workspaceId || profile?.active_workspace_id || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" title="Account" className="flex h-9 items-center gap-1.5 px-1.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#1557c9] text-[11px] font-semibold text-white ring-2 ring-background">
            {profileInitials(userName)}
          </span>
          <ChevronDown className="hidden size-3.5 text-subtle-foreground sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{userName}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={!profileWorkspaceId}
          onSelect={() => {
            if (!profileWorkspaceId) return;
            navigate(profileSettingsPath(locale, profileWorkspaceId));
          }}
        >
          <User className="h-4 w-4 mr-2 text-muted-foreground" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => logOut()}>
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
