import { Check, ChevronDown, LogOut, Moon, Sun, SunMoon, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { useUser } from "../features/auth/useUser";
import { useLogOut } from "../features/auth/useLogOut";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { useUpdateProfileTheme } from "../features/profiles/useUpdateProfile";
import { profileDisplayName, profileInitials } from "../features/profiles/profileName";
import { profileSettingsPath } from "../features/settings/settingsTab";
import {
  applyProfileTheme,
  cacheProfileTheme,
  normalizeProfileTheme,
  type ProfileTheme,
} from "../services/apiProfiles";

const themeChoices = [
  { value: "light" as const, icon: Sun, labelKey: "nav.userMenu.themeLight" },
  { value: "dark" as const, icon: Moon, labelKey: "nav.userMenu.themeDark" },
  { value: "system" as const, icon: SunMoon, labelKey: "nav.userMenu.themeSystem" },
] as const;

export default function UserMenu() {
  const { t } = useTranslation();
  const { logOut } = useLogOut();
  const { user } = useUser();
  const { data: profile } = useGetProfile();
  const { mutateAsync: saveTheme, isPending: themePending } = useUpdateProfileTheme();
  const navigate = useNavigate();
  const { locale = "en", workspaceId } = useParams();
  const userName = profileDisplayName(profile?.full_name, typeof user?.user_metadata?.ownerName === "string" ? user.user_metadata.ownerName : null);
  const email = profile?.email || user?.email;
  const profileWorkspaceId = workspaceId || profile?.active_workspace_id || "";
  const currentTheme = normalizeProfileTheme(profile?.theme);

  async function onSelectTheme(next: ProfileTheme) {
    if (next === currentTheme || themePending) return;
    cacheProfileTheme(next);
    applyProfileTheme(next, window.matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      await saveTheme(next);
    } catch {
      const fallback = currentTheme;
      cacheProfileTheme(fallback);
      applyProfileTheme(fallback, window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" title={t("nav.userMenu.account")} className="flex h-9 items-center gap-1.5 px-1.5">
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
          <User className="mr-2 h-4 w-4 text-muted-foreground" />
          {t("nav.userMenu.profile")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("nav.userMenu.theme")}</DropdownMenuLabel>
        {themeChoices.map((choice) => {
          const Icon = choice.icon;
          const selected = currentTheme === choice.value;
          return (
            <DropdownMenuItem
              key={choice.value}
              className="cursor-pointer"
              disabled={themePending}
              onSelect={(event) => {
                event.preventDefault();
                void onSelectTheme(choice.value);
              }}
            >
              <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{t(choice.labelKey)}</span>
              {selected ? <Check className="h-4 w-4 text-foreground" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => logOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          {t("nav.userMenu.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
