import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { Button } from "./Button";

export default function AppTopbarNotifications() {
  const { t } = useTranslation();

  const notifications = [
    { id: 1, title: t("nav.notifications.newOrder"), time: t("nav.notifications.minutesAgo", { count: 5 }) },
    { id: 2, title: t("nav.notifications.invoiceOverdue", { invoiceNumber: "INV-2024-003" }), time: t("nav.notifications.hoursAgo", { count: 1 }) },
    {
      id: 3,
      title: t("nav.notifications.lowStock", { itemName: "Samsung Galaxy S24 Screen" }),
      time: t("nav.notifications.hoursAgo", { count: 2 }),
    },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("nav.notifications.title")} className="relative">
          <Bell className="size-[18px]" />
          <span aria-hidden="true" className="absolute top-2 right-2 size-2 rounded-full bg-destructive ring-2 ring-background" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t("nav.notifications.title")}</span>
          <span className="text-xs font-normal text-primary cursor-pointer hover:underline">{t("nav.notifications.markAllRead")}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.map((notification) => (
          <DropdownMenuItem key={notification.id} className="flex flex-col items-start py-3 cursor-pointer">
            <span className="text-sm text-foreground">{notification.title}</span>
            <span className="text-xs text-muted-foreground">{notification.time}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-center text-primary cursor-pointer justify-center">{t("nav.notifications.viewAll")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
