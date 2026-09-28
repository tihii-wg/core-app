import { useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { Avatar, AvatarFallback } from "../../ui/Avatar";
import { Separator } from "../../ui/Separator";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { ProfileSettings } from "./ProfileSettings";
import { CompanySettings } from "./CompanySettings";
import { SecuritySettings } from "./SecuritySettings";
import { replaceLocale, settingsTabFromSearch } from "./settingsTab";
import { useGetProfile } from "../profiles/useGetProfile";
import { useUpdateProfileTheme } from "../profiles/useUpdateProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspacePreferences } from "../workspaces/useUpdateWorkspace";
import { applyProfileTheme, normalizeProfileTheme, type ProfileTheme } from "../../services/apiProfiles";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { workspacePreferenceDefaults } from "../../lib/workspaceFormat";

export function SettingsModule() {
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
        title="Settings"
        description="Manage your business settings and preferences"
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
        <TabsList className="flex-wrap">
          <TabsTrigger value="company">
            <Building2 className="mr-2 h-4 w-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="mr-2 h-4 w-4" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-2 h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="mr-2 h-4 w-4" />
            Appearance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6 space-y-6">
          <CompanySettings />
        </TabsContent>

        {/* Profile Settings */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <ProfileSettings />
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>
                Manage your email notification preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  key: "emailOrders",
                  label: "Order updates",
                  description: "Receive emails about order status changes",
                },
                {
                  key: "emailInvoices",
                  label: "Invoice notifications",
                  description: "Get notified when invoices are created or paid",
                },
                {
                  key: "emailMarketing",
                  label: "Marketing emails",
                  description: "Receive promotional offers and updates",
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Push Notifications</CardTitle>
              <CardDescription>
                Manage your push notification preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  key: "pushOrders",
                  label: "New orders",
                  description: "Get notified when new orders are placed",
                },
                {
                  key: "pushReminders",
                  label: "Reminders",
                  description: "Receive appointment and task reminders",
                },
                {
                  key: "pushAlerts",
                  label: "System alerts",
                  description: "Important system notifications and alerts",
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <SecuritySettings />
        </TabsContent>

        {/* Billing Settings */}
        <TabsContent value="billing" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>
                Manage your subscription and billing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border bg-primary/5 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-foreground">
                      Professional Plan
                    </h3>
                    <p className="text-muted-foreground">
                      $49/month, billed monthly
                    </p>
                  </div>
                  <Button>Upgrade Plan</Button>
                </div>
                <Separator className="my-4" />
                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Users</p>
                    <p className="font-medium">5 of 10</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Storage</p>
                    <p className="font-medium">2.5 GB of 10 GB</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Next Billing</p>
                    <p className="font-medium">Feb 1, 2024</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium text-green-600">Active</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
              <CardDescription>Manage your payment methods</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-14 items-center justify-center rounded bg-muted">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-medium">Visa ending in 4242</p>
                    <p className="text-sm text-muted-foreground">
                      Expires 12/2025
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </div>
              <Button variant="outline">Add Payment Method</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Settings */}
        <TabsContent value="team" className="mt-6 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>
                  Manage your team and their permissions
                </CardDescription>
              </div>
              <Button>Invite Member</Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    name: "John Doe",
                    email: "john@example.com",
                    role: "Admin",
                    status: "Active",
                  },
                  {
                    name: "Sarah Smith",
                    email: "sarah@example.com",
                    role: "Manager",
                    status: "Active",
                  },
                  {
                    name: "Mike Johnson",
                    email: "mike@example.com",
                    role: "Technician",
                    status: "Active",
                  },
                  {
                    name: "Emily Brown",
                    email: "emily@example.com",
                    role: "Sales",
                    status: "Pending",
                  },
                ].map((member) => (
                  <div
                    key={member.email}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar>
                        <AvatarFallback>
                          {member.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {member.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          member.status === "Active"
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {member.status}
                      </span>
                      <Select defaultValue={member.role.toLowerCase()}>
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="technician">Technician</SelectItem>
                          <SelectItem value="sales">Sales</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="mt-6 space-y-6">
          <AppearanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const themeOptions: { value: ProfileTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const languageOptions = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

const timezoneOptions = [
  { value: "Europe/Chisinau", label: "Chisinau (Europe/Chisinau)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
];

const dateFormatOptions = ["DD.MM.YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"].map((value) => ({ value, label: value }));

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
  const { workspaceId } = useParams();
  const { data: workspace, isLoading, error, isFetched } = useGetWorkspace(workspaceId);
  const { data: profile, isLoading: profileLoading } = useGetProfile();

  if (isLoading || profileLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Display Preferences</CardTitle>
          <CardDescription>Customize how the application looks</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading preferences...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Preferences could not be loaded";
    return (
      <Card>
        <CardHeader>
          <CardTitle>Display Preferences</CardTitle>
          <CardDescription>Customize how the application looks</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#f41f20]">{message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isFetched && !workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Display Preferences</CardTitle>
          <CardDescription>Customize how the application looks</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You can only view and edit companies you belong to.</p>
        </CardContent>
      </Card>
    );
  }

  if (!workspace) return null;

  return <AppearanceForm key={`${workspace.id}:${profile?.theme ?? "system"}:${workspace.language}:${workspace.timezone}:${workspace.dateFormat}:${workspace.currency}`} workspace={workspace} theme={normalizeProfileTheme(profile?.theme)} />;
}

function AppearanceForm({ workspace, theme: savedTheme }: { workspace: WorkspaceDetails; theme: ProfileTheme }) {
  const { locale = "en" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ProfileTheme>(savedTheme);
  const [language, setLanguage] = useState(workspace.language ?? workspacePreferenceDefaults.language);
  const [timezone, setTimezone] = useState(workspace.timezone ?? workspacePreferenceDefaults.timezone);
  const [dateFormat, setDateFormat] = useState(workspace.dateFormat ?? workspacePreferenceDefaults.dateFormat);
  const [currency, setCurrency] = useState(workspace.currency ?? workspacePreferenceDefaults.currency);
  const { mutateAsync: saveTheme, isPending: themePending } = useUpdateProfileTheme();
  const { mutateAsync: savePreferences, isPending: preferencesPending } = useUpdateWorkspacePreferences();
  const isPending = themePending || preferencesPending;

  async function onSave() {
    toast.loading("Saving preferences...", { id: "appearance" });
    const failures: string[] = [];

    try {
      await saveTheme(theme);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Could not save theme");
      applyProfileTheme(savedTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);
    }

    try {
      const saved = await savePreferences({ workspaceId: workspace.id, language, timezone, dateFormat, currency });
      const nextLanguage = saved?.language ?? language;
      const nextPath = replaceLocale(location.pathname, locale, nextLanguage);
      if (nextPath !== location.pathname) navigate(`${nextPath}${location.search}`, { replace: true });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Could not save company preferences");
    }

    if (failures.length > 0) {
      toast.error(failures.join(" "), { id: "appearance" });
      return;
    }

    toast.success("Preferences saved", { id: "appearance" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Preferences</CardTitle>
        <CardDescription>Customize how the application looks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select
              value={theme}
              onValueChange={(value) => {
                const nextTheme = normalizeProfileTheme(value);
                setTheme(nextTheme);
                applyProfileTheme(nextTheme, window.matchMedia("(prefers-color-scheme: dark)").matches);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {themeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(languageOptions, language).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(timezoneOptions, timezone).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(dateFormatOptions, dateFormat).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
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

        <div className="flex justify-end">
          <Button type="button" onClick={onSave} disabled={isPending}>
            <Save className="mr-2 h-4 w-4" />
            Save Preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
