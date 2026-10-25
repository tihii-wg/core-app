import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Globe2, Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { languageNames, supportedLanguages } from "../../i18n/languages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspacePreferences } from "../workspaces/useUpdateWorkspace";
import { normalizeWorkspaceDateFormat, normalizeWorkspaceLanguage, type WorkspaceDetails } from "../../services/apiWorkspaces";
import { workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { countryOptions, normalizeDocumentLanguage } from "../../lib/workspaceGeneralSettings";
import { replaceLocale } from "./settingsTab";

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

function RegionalForm({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const { locale = "en" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [language, setLanguage] = useState(normalizeWorkspaceLanguage(workspace.language));
  const [documentLanguage, setDocumentLanguage] = useState(normalizeDocumentLanguage(workspace.documentLanguage));
  const [countryCode, setCountryCode] = useState(workspace.countryCode || "MD");
  const [timezone, setTimezone] = useState(workspace.timezone ?? workspacePreferenceDefaults.timezone);
  const [dateFormat, setDateFormat] = useState(normalizeWorkspaceDateFormat(workspace.dateFormat));
  const [currency, setCurrency] = useState(workspace.currency ?? workspacePreferenceDefaults.currency);
  const { mutateAsync: savePreferences, isPending } = useUpdateWorkspacePreferences();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  const translatedTimezones = timezoneOptions.map((option) => ({ value: option.value, label: t(option.labelKey) }));

  const dirty =
    language !== normalizeWorkspaceLanguage(workspace.language) ||
    documentLanguage !== normalizeDocumentLanguage(workspace.documentLanguage) ||
    countryCode !== (workspace.countryCode || "MD") ||
    timezone !== (workspace.timezone ?? workspacePreferenceDefaults.timezone) ||
    dateFormat !== normalizeWorkspaceDateFormat(workspace.dateFormat) ||
    currency !== (workspace.currency ?? workspacePreferenceDefaults.currency);

  async function onSave() {
    if (!canEdit || !dirty) return;
    if (!timezone.trim()) {
      toast.error(t("settings.appearance.errors.timezoneRequired"), { id: "regional" });
      return;
    }
    if (!currency.trim()) {
      toast.error(t("settings.appearance.errors.currencyRequired"), { id: "regional" });
      return;
    }

    toast.loading(t("settings.general.regional.toast.saving"), { id: "regional" });
    try {
      const saved = await savePreferences({
        workspaceId: workspace.id,
        language,
        documentLanguage,
        countryCode,
        timezone,
        dateFormat,
        currency,
      });
      const nextLanguage = saved?.language ?? language;
      const nextPath = replaceLocale(location.pathname, locale, nextLanguage);
      if (nextPath !== location.pathname) navigate(`${nextPath}${location.search}`, { replace: true });
      toast.success(t("settings.general.regional.toast.saved"), { id: "regional" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.regional.toast.failed"), { id: "regional" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.regional.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.regional.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="regional-country">{t("settings.general.regional.country")}</Label>
            <Select value={countryCode} onValueChange={setCountryCode} disabled={!canEdit || isPending}>
              <SelectTrigger id="regional-country" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(
                  countryOptions.map((option) => ({ value: option.value, label: t(option.labelKey) })),
                  countryCode,
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="regional-document-language">{t("settings.general.regional.documentLanguage")}</Label>
            <Select
              value={documentLanguage}
              onValueChange={(value) => setDocumentLanguage(normalizeDocumentLanguage(value))}
              disabled={!canEdit || isPending}
            >
              <SelectTrigger id="regional-document-language" className="w-full">
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
            <p className="text-xs text-muted-foreground">{t("settings.general.regional.documentLanguageHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="regional-language">{t("settings.general.regional.language")}</Label>
            <Select value={language} onValueChange={(value) => setLanguage(normalizeWorkspaceLanguage(value))} disabled={!canEdit || isPending}>
              <SelectTrigger id="regional-language" className="w-full">
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
            <p className="text-xs text-muted-foreground">{t("settings.general.regional.interfaceLanguageHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="regional-timezone">{t("settings.general.regional.timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canEdit || isPending}>
              <SelectTrigger id="regional-timezone" className="w-full">
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
            <Label htmlFor="regional-date-format">{t("settings.general.regional.dateFormat")}</Label>
            <Select value={dateFormat} onValueChange={(value) => setDateFormat(normalizeWorkspaceDateFormat(value))} disabled={!canEdit || isPending}>
              <SelectTrigger id="regional-date-format" className="w-full">
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
            <Label htmlFor="regional-currency">{t("settings.general.regional.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={!canEdit || isPending}>
              <SelectTrigger id="regional-currency" className="w-full">
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

        {canEdit ? (
          <div className="flex justify-end border-t border-border pt-5">
            <Button type="button" onClick={() => void onSave()} disabled={isPending || !dirty}>
              <Save />
              {isPending ? t("common.saving") : t("settings.general.regional.save")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.general.regional.ownerOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function RegionalSettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error, refetch, isFetched } = useGetWorkspace(workspaceId);

  if (!workspaceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.regional.title")}</CardTitle>
          <CardDescription>{t("settings.general.regional.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.company.chooseCompany")}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.regional.title")}</CardTitle>
          <CardDescription>{t("settings.general.regional.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : t("settings.general.regional.loadFailed");
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.regional.title")}</CardTitle>
          <CardDescription>{t("settings.general.regional.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{message}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isFetched && !workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.regional.title")}</CardTitle>
          <CardDescription>{t("settings.general.regional.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.company.notMember")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!workspace) return null;

  return (
    <RegionalForm
      key={`${workspace.id}:${workspace.language}:${workspace.documentLanguage}:${workspace.countryCode}:${workspace.timezone}:${workspace.dateFormat}:${workspace.currency}`}
      workspace={workspace}
    />
  );
}
