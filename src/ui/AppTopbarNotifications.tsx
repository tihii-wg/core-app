import { Bell } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { Button } from "./Button";

export default function AppTopbarNotifications() {

  const notifications = [
    { id: 1, title: "New order received", time: "5 min ago" },
    { id: 2, title: "Invoice #INV-2024-003 is overdue", time: "1 hour ago" },
    {
      id: 3,
      title: "Low stock alert: Samsung Galaxy S24 Screen",
      time: "2 hours ago",
    },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-[#939699] hover:text-[#282e33]">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 h-2 w-2 bg-[#f41f20] rounded-full" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <span className="text-xs font-normal text-[#1973e1] cursor-pointer hover:underline">Mark all read</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.map((notification) => (
          <DropdownMenuItem key={notification.id} className="flex flex-col items-start py-3 cursor-pointer">
            <span className="text-sm text-[#282e33]">{notification.title}</span>
            <span className="text-xs text-[#939699]">{notification.time}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-center text-[#1973e1] cursor-pointer justify-center">View all notifications</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
