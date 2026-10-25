import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  SlidersHorizontal,
  User,
  Bell,
  Shield,
  CreditCard,
  Users,
  Palette,
  Save,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../ui/Card";


import { Switch } from "../../ui/Switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/Select";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { ProfileSettings } from "./ProfileSettings";
import { GeneralSettings } from "./GeneralSettings";
import { SecuritySettings } from "./SecuritySettings";
import { settingsTabFromSearch } from "./settingsTab";
import { useActiveWorkspaceId, useGetProfile } from "../profiles/useGetProfile";
import { useUpdateProfileTheme } from "../profiles/useUpdateProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { applyProfileTheme, normalizeProfileTheme, type ProfileTheme } from "../../services/apiProfiles";
import { TeamSettings } from "./TeamSettings";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";

export function SettingsModule() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = settingsTabFromSearch(searchParams.get("tab"));

  const [notifications, setNotifications] = useState({
    emailOrders: true,
    emailInvoices: true,
    emailMarketing: false,
    pushOrders: true,
    pushReminders: true,
    pushAlerts: true,
    smsOrders: false,
    smsReminders: true,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          const next = settingsTabFromSearch(tab);
          if (next === "general") {
            setSearchParams({}, { replace: true });
            return;
          }
          setSearchParams({ tab: next }, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="general">
            <SlidersHorizontal />
            {t("settings.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User />
            {t("settings.tabs.profile")}
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell />
            {t("settings.tabs.notifications")}
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield />
            {t("settings.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard />
            {t("settings.tabs.billing")}
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users />
            {t("settings.tabs.team")}
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette />
            {t("settings.tabs.appearance")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-5 space-y-5">
          <GeneralSettings />
        </TabsContent>

        {/* Profile Settings */}
        <TabsContent value="profile" className="mt-5 space-y-5">
          <ProfileSettings />
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="mt-5 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.notifications.email.title")}</CardTitle>
              <CardDescription>
                {t("settings.notifications.email.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border rounded-lg border border-border">
              {[
                {
                  key: "emailOrders",
                  label: t("settings.notifications.email.orders.label"),
                  description: t("settings.notifications.email.orders.description"),
                },
                {
                  key: "emailInvoices",
                  label: t("settings.notifications.email.invoices.label"),
                  description: t("settings.notifications.email.invoices.description"),
                },
                {
                  key: "emailMarketing",
                  label: t("settings.notifications.email.marketing.label"),
                  description: t("settings.notifications.email.marketing.description"),
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
                    aria-label={item.label}
                    checked={
                      notifications[item.key as keyof typeof notifications]
                    }
                    onCheckedChange={(checked) =>
                      setNotifications({
                        ...notifications,
                        [item.key]: checked,
                      })
                    }
                  />
                </div>
              ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.notifications.push.title")}</CardTitle>
              <CardDescription>
                {t("settings.notifications.push.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border rounded-lg border border-border">
              {[
                {
                  key: "pushOrders",
                  label: t("settings.notifications.push.orders.label"),
                  description: t("settings.notifications.push.orders.description"),
                },
                {
                  key: "pushReminders",
                  label: t("settings.notifications.push.reminders.label"),
                  description: t("settings.notifications.push.reminders.description"),
                },
                {
                  key: "pushAlerts",
                  label: t("settings.notifications.push.alerts.label"),
                  description: t("settings.notifications.push.alerts.description"),
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
                    aria-label={item.label}
                    checked={
                      notifications[item.key as keyof typeof notifications]
                    }
                    onCheckedChange={(checked) =>
                      setNotifications({
                        ...notifications,
                        [item.key]: checked,
                      })
                    }
                  />
                </div>
              ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-5 space-y-5">
          <SecuritySettings />
        </TabsContent>

        {/* Billing Settings */}
        <TabsContent value="billing" className="mt-5 space-y-5">
          <SubscriptionStatusCard />

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.billing.paymentMethod.title")}</CardTitle>
              <CardDescription>{t("settings.billing.paymentMethod.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t("settings.subscription.paymentsUnavailable")}</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Settings */}
        <TabsContent value="team" className="mt-5 space-y-5">
          <TeamSettings />
        </TabsContent>

        <TabsContent value="appearance" className="mt-5 space-y-5">
          <AppearanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const themeOptions = [
  { value: "light", labelKey: "settings.appearance.themes.light" },
  { value: "dark", labelKey: "settings.appearance.themes.dark" },
  { value: "system", labelKey: "settings.appearance.themes.system" },
] as const satisfies readonly { value: ProfileTheme; labelKey: string }[];

function AppearanceSettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error, isFetched } = useGetWorkspace(workspaceId);
  const { data: profile, isLoading: profileLoading } = useGetProfile();

  if (isLoading || profileLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.appearance.loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : t("settings.appearance.loadFailed");
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isFetched && !workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.company.notMember")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!workspace) return null;

  return <AppearanceForm key={`${workspace.id}:${profile?.theme ?? "system"}`} theme={normalizeProfileTheme(profile?.theme)} />;
}

function AppearanceForm({ theme: savedTheme }: { theme: ProfileTheme }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ProfileTheme>(savedTheme);
  const { mutateAsync: saveTheme, isPending } = useUpdateProfileTheme();

  async function onSave() {
    toast.loading(t("settings.appearance.toast.saving"), { id: "appearance" });
    try {
      await saveTheme(theme);
      toast.success(t("settings.appearance.toast.saved"), { id: "appearance" });
    } catch (error) {
      applyProfileTheme(savedTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);
      toast.error(error instanceof Error ? error.message : t("settings.appearance.toast.themeFailed"), { id: "appearance" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.appearance.title")}</CardTitle>
        <CardDescription>{t("settings.appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="pref-theme">{t("settings.appearance.theme")}</Label>
          <Select
            value={theme}
            onValueChange={(value) => {
              const nextTheme = normalizeProfileTheme(value);
              setTheme(nextTheme);
              applyProfileTheme(nextTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);
            }}
          >
            <SelectTrigger id="pref-theme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end border-t border-border pt-5">
          <Button type="button" onClick={() => void onSave()} disabled={isPending}>
            <Save />
            {t("settings.appearance.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
