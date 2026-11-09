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
  FileSpreadsheet,
  Tags,
  FormInput,
  MapPin,
  KeyRound,
  Warehouse,
  Printer,
  Percent,
  DatabaseZap,
  Blocks,
  HardDriveDownload,
  HardDrive,
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
import { ImportDataDemo } from "./ImportDataDemo";
import { StatusesSettings } from "./StatusesSettings";
import { OrderFieldsSettings } from "./OrderFieldsSettings";
import { LocationsSettings } from "./LocationsSettings";
import { RolesSettings } from "./RolesSettings";
import { PrintTemplatesSettings } from "./PrintTemplatesSettings";
import { TaxesSettings } from "./TaxesSettings";
import { BackupsSettings } from "./backups/BackupsSettings";
import { StorageSettings } from "./storage/StorageSettings";
import { NotificationRulesSettings } from "./NotificationRulesSettings";
import { WarehousesSettings } from "./WarehousesSettings";
import { ComingModulesSettings } from "./ComingModulesSettings";
import { MigrationSettings } from "../migration/MigrationSettings";

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
          <TabsTrigger value="statuses">
            <Tags />
            {t("settings.tabs.statuses")}
          </TabsTrigger>
          <TabsTrigger value="orderFields">
            <FormInput />
            {t("settings.tabs.orderFields")}
          </TabsTrigger>
          <TabsTrigger value="locations">
            <MapPin />
            {t("settings.tabs.locations")}
          </TabsTrigger>
          <TabsTrigger value="warehouses">
            <Warehouse />
            {t("settings.tabs.warehouses")}
          </TabsTrigger>
          <TabsTrigger value="roles">
            <KeyRound />
            {t("settings.tabs.roles")}
          </TabsTrigger>
          <TabsTrigger value="printTemplates">
            <Printer />
            {t("settings.tabs.printTemplates")}
          </TabsTrigger>
          <TabsTrigger value="taxes">
            <Percent />
            {t("settings.tabs.taxes")}
          </TabsTrigger>
          <TabsTrigger value="backups">
            <HardDriveDownload />
            {t("settings.tabs.backups")}
          </TabsTrigger>
          <TabsTrigger value="storage">
            <HardDrive />
            {t("settings.tabs.storage")}
          </TabsTrigger>
          <TabsTrigger value="import">
            <FileSpreadsheet />
            {t("settings.tabs.import")}
          </TabsTrigger>
          <TabsTrigger value="migration">
            <DatabaseZap />
            {t("settings.tabs.migration")}
          </TabsTrigger>
          <TabsTrigger value="modules">
            <Blocks />
            {t("settings.tabs.modules")}
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

          <NotificationRulesSettings />
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
          <ContrastReviewCard />
        </TabsContent>

        <TabsContent value="statuses" className="mt-5 space-y-5">
          <StatusesSettings />
        </TabsContent>

        <TabsContent value="orderFields" className="mt-5 space-y-5">
          <OrderFieldsSettings />
        </TabsContent>

        <TabsContent value="locations" className="mt-5 space-y-5">
          <LocationsSettings />
        </TabsContent>

        <TabsContent value="warehouses" className="mt-5 space-y-5">
          <WarehousesSettings />
        </TabsContent>

        <TabsContent value="roles" className="mt-5 space-y-5">
          <RolesSettings />
        </TabsContent>

        <TabsContent value="printTemplates" className="mt-5 space-y-5">
          <PrintTemplatesSettings />
        </TabsContent>

        <TabsContent value="taxes" className="mt-5 space-y-5">
          <TaxesSettings />
        </TabsContent>

        <TabsContent value="backups" className="mt-5 space-y-5">
          <BackupsSettings />
        </TabsContent>

        <TabsContent value="storage" className="mt-5 space-y-5">
          <StorageSettings />
        </TabsContent>

        <TabsContent value="import" className="mt-5 space-y-5">
          <ImportDataDemo />
        </TabsContent>

        <TabsContent value="migration" className="mt-5 space-y-5">
          <MigrationSettings />
        </TabsContent>

        <TabsContent value="modules" className="mt-5 space-y-5">
          <ComingModulesSettings />
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

const contrastReviewRows = [
  { pair: "--subtle-foreground / --muted", theme: "light", current: "3.22 / 2.89", proposed: "#686e77 → 5.14 / 4.62" },
  { pair: "--subtle-foreground / --muted", theme: "dark", current: "4.11 / 3.73", proposed: "#8a919c → 5.60 / 5.09" },
  { pair: "white on --primary", theme: "dark", current: "3.68", proposed: "--primary-foreground: #0e1014 → 5.18" },
  { pair: "white on --destructive", theme: "dark", current: "3.46", proposed: "--destructive-foreground: #0e1014 → 5.51" },
] as const;

function ContrastReviewCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.appearance.contrastReview.title")}</CardTitle>
        <CardDescription>{t("settings.appearance.contrastReview.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("settings.appearance.contrastReview.pair")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.appearance.contrastReview.theme")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.appearance.contrastReview.current")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.appearance.contrastReview.proposed")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contrastReviewRows.map((row) => (
                <tr key={`${row.pair}-${row.theme}`}>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{row.pair}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.theme}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.current}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.proposed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("settings.appearance.contrastReview.note")}</p>
      </CardContent>
    </Card>
  );
}

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
