import { useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  Building2,
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
import { Separator } from "../../ui/Separator";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { StatusBadge } from "../../ui/StatusBadge";
import { ProfileSettings } from "./ProfileSettings";
import { CompanySettings } from "./CompanySettings";
import { SecuritySettings } from "./SecuritySettings";
import { replaceLocale, settingsTabFromSearch } from "./settingsTab";
import { languageNames, supportedLanguages } from "../../i18n/languages";
import { currentIntlLocale } from "../../i18n";
import { useActiveWorkspaceId, useGetProfile } from "../profiles/useGetProfile";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { useUpdateProfileTheme } from "../profiles/useUpdateProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspacePreferences } from "../workspaces/useUpdateWorkspace";
import { applyProfileTheme, normalizeProfileTheme, type ProfileTheme } from "../../services/apiProfiles";
import { normalizeWorkspaceDateFormat, normalizeWorkspaceLanguage, type WorkspaceDetails } from "../../services/apiWorkspaces";
import { workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { TeamSettings } from "./TeamSettings";

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

  const nextBillingDate = new Date(2024, 1, 1).toLocaleDateString(currentIntlLocale(), { month: "short", day: "numeric", year: "numeric" });

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
          if (next === "company") {
            setSearchParams({}, { replace: true });
            return;
          }
          setSearchParams({ tab: next }, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="company">
            <Building2 />
            {t("settings.tabs.company")}
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

        <TabsContent value="company" className="mt-5 space-y-5">
          <CompanySettings />
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
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.billing.currentPlan.title")}</CardTitle>
              <CardDescription>
                {t("settings.billing.currentPlan.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-primary/20 bg-accent/50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {t("settings.billing.currentPlan.planName")}
                    </h3>
                    <p className="text-[13px] text-muted-foreground">
                      {t("settings.billing.currentPlan.price", { price: "$49" })}
                    </p>
                  </div>
                  <Button>{t("settings.billing.currentPlan.upgrade")}</Button>
                </div>
                <Separator className="my-4" />
                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">{t("settings.billing.currentPlan.users")}</p>
                    <p className="font-medium">{t("settings.billing.currentPlan.usersValue", { used: 5, total: 10 })}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("settings.billing.currentPlan.storage")}</p>
                    <p className="font-medium">{t("settings.billing.currentPlan.storageValue", { used: (2.5).toLocaleString(currentIntlLocale()), total: 10 })}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("settings.billing.currentPlan.nextBilling")}</p>
                    <p className="font-medium">{nextBillingDate}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("common.status")}</p>
                    <StatusBadge variant="success" dot className="mt-0.5">{t("settings.billing.currentPlan.active")}</StatusBadge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.billing.paymentMethod.title")}</CardTitle>
              <CardDescription>{t("settings.billing.paymentMethod.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                    <CreditCard aria-hidden="true" className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.billing.paymentMethod.cardEnding", { last4: "4242" })}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {t("settings.billing.paymentMethod.expires", { date: "12/2025" })}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  {t("common.edit")}
                </Button>
              </div>
              <Button variant="outline">{t("settings.billing.paymentMethod.add")}</Button>
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

const languageOptions = supportedLanguages.map((value) => ({ value, label: languageNames[value] }));

const timezoneOptions = [
  { value: "Europe/Chisinau", labelKey: "settings.appearance.timezones.chisinau" },
  { value: "America/Los_Angeles", labelKey: "settings.appearance.timezones.pacific" },
  { value: "America/Denver", labelKey: "settings.appearance.timezones.mountain" },
  { value: "America/Chicago", labelKey: "settings.appearance.timezones.central" },
  { value: "America/New_York", labelKey: "settings.appearance.timezones.eastern" },
] as const;

const dateFormatOptions = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((value) => ({ value, label: value }));

const currencyOptions = [
  { value: "MDL", label: "MDL (L)" },
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "CAD", label: "CAD ($)" },
];

function withCurrent(options: { value: string; label: string }[], current: string) {
  if (options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
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

  return <AppearanceForm key={`${workspace.id}:${profile?.theme ?? "system"}:${workspace.language}:${workspace.timezone}:${workspace.dateFormat}:${workspace.currency}`} workspace={workspace} theme={normalizeProfileTheme(profile?.theme)} />;
}

function AppearanceForm({ workspace, theme: savedTheme }: { workspace: WorkspaceDetails; theme: ProfileTheme }) {
  const { t } = useTranslation();
  const { locale = "en" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ProfileTheme>(savedTheme);
  const [language, setLanguage] = useState(normalizeWorkspaceLanguage(workspace.language));
  const [timezone, setTimezone] = useState(workspace.timezone ?? workspacePreferenceDefaults.timezone);
  const [dateFormat, setDateFormat] = useState(normalizeWorkspaceDateFormat(workspace.dateFormat));
  const [currency, setCurrency] = useState(workspace.currency ?? workspacePreferenceDefaults.currency);
  const { mutateAsync: saveTheme, isPending: themePending } = useUpdateProfileTheme();
  const { mutateAsync: savePreferences, isPending: preferencesPending } = useUpdateWorkspacePreferences();
  const isPending = themePending || preferencesPending;
  const canEditWorkspace = canManageWorkspace(workspace.role);
  const translatedTimezones = timezoneOptions.map((option) => ({ value: option.value, label: t(option.labelKey) }));

  async function onSave() {
    toast.loading(t("settings.appearance.toast.saving"), { id: "appearance" });
    const failures: string[] = [];

    try {
      await saveTheme(theme);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : t("settings.appearance.toast.themeFailed"));
      applyProfileTheme(savedTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);
    }

    if (canEditWorkspace) {
      try {
        const saved = await savePreferences({ workspaceId: workspace.id, language, timezone, dateFormat, currency });
        const nextLanguage = saved?.language ?? language;
        const nextPath = replaceLocale(location.pathname, locale, nextLanguage);
        if (nextPath !== location.pathname) navigate(`${nextPath}${location.search}`, { replace: true });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : t("settings.appearance.toast.companyPreferencesFailed"));
      }
    }

    if (failures.length > 0) {
      toast.error(failures.join(" "), { id: "appearance" });
      return;
    }

    toast.success(t("settings.appearance.toast.saved"), { id: "appearance" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.appearance.title")}</CardTitle>
        <CardDescription>{t("settings.appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="pref-language">{t("settings.appearance.language")}</Label>
            <Select value={language} onValueChange={(value) => setLanguage(normalizeWorkspaceLanguage(value))} disabled={!canEditWorkspace}>
              <SelectTrigger id="pref-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-timezone">{t("settings.appearance.timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canEditWorkspace}>
              <SelectTrigger id="pref-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(translatedTimezones, timezone).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-date-format">{t("settings.appearance.dateFormat")}</Label>
            <Select value={dateFormat} onValueChange={(value) => setDateFormat(normalizeWorkspaceDateFormat(value))} disabled={!canEditWorkspace}>
              <SelectTrigger id="pref-date-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dateFormatOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-currency">{t("settings.appearance.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={!canEditWorkspace}>
              <SelectTrigger id="pref-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(currencyOptions, currency).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!canEditWorkspace && <p className="text-sm text-muted-foreground">{t("settings.appearance.ownerOnlyHint")}</p>}

        <div className="flex justify-end border-t border-border pt-5">
          <Button type="button" onClick={onSave} disabled={isPending}>
            <Save />
            {t("settings.appearance.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
