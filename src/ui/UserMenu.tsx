import { ChevronDown, LogOut, User } from "lucide-react";
import { Button } from "./Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { useUser } from "../features/auth/useUser";
import { useLogOut } from "../features/auth/useLogOut";

export default function UserMenu() {
  const { logOut } = useLogOut();
  const { user } = useUser();
  const userName = user.user_metadata.ownerName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
          <div className="h-8 w-8 bg-[#1973e1] rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">{userName.charAt(0) || "U"}</span>
          </div>
          <ChevronDown className="h-4 w-4 text-[#939699] hidden sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium">{userName}</span>
            <span className="text-xs text-[#939699] font-normal">{user?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer">
          <User className="h-4 w-4 mr-2 text-[#939699]" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer text-[#f41f20] focus:text-[#f41f20]" onClick={() => logOut()}>
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
