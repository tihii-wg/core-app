import { useEffect, useMemo, useState } from "react";
import { HardDrive, FolderGit2, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../ui/Card";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";
import { Switch } from "../../../ui/Switch";
import { formatBackupSize, type BackupProvider } from "../../../services/apiBackups";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetWorkspace } from "../../workspaces/useGetWorkspace";
import { useActiveWorkspaceRole } from "../../workspaces/useActiveWorkspaceRole";
import { canManageWorkspace } from "../../workspaces/workspaceRoles";
import { localHourToUtcHour, utcHourToLocalHour } from "./schedule";
import {
  useBackupRuns,
  useBackupSettings,
  useConnectGitHub,
  useConnectGoogleDrive,
  useDisconnectBackup,
  useRunBackup,
  useUpdateBackupSettings,
} from "./useBackups";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function BackupsSettings() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useActiveWorkspaceRole();
  const isOwner = canManageWorkspace(role);
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const timeZone = workspace?.timezone?.trim() || "UTC";

  const settingsQuery = useBackupSettings(true);
  const settings = settingsQuery.data;
  const hasActiveRun = (status: string | undefined) => status === "queued" || status === "running";

  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubPath, setGithubPath] = useState("core-app-backups");
  const [githubToken, setGithubToken] = useState("");
  const [localHour, setLocalHour] = useState(3);
  const [providerDraft, setProviderDraft] = useState<BackupProvider>("google_drive");
  const [pollWhileActive, setPollWhileActive] = useState(false);

  const runsQuery = useBackupRuns(true, pollWhileActive ? 2500 : false);
  const history = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const activeRun = history.some((run) => hasActiveRun(run.status));

  useEffect(() => {
    if (activeRun) setPollWhileActive(true);
    else setPollWhileActive(false);
  }, [activeRun]);

  const updateSettings = useUpdateBackupSettings();
  const disconnect = useDisconnectBackup();
  const connectGoogle = useConnectGoogleDrive();
  const connectGitHub = useConnectGitHub();
  const runBackup = useRunBackup();

  useEffect(() => {
    if (!settings) return;
    setProviderDraft(settings.provider ?? "google_drive");
    setGithubRepo(settings.githubRepo ?? "");
    setGithubBranch(settings.githubBranch ?? "main");
    setGithubPath(settings.githubPath ?? "core-app-backups");
    setLocalHour(utcHourToLocalHour(settings.hourUtc, timeZone));
  }, [settings, timeZone]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;
    if (connected === "google") toast.success(t("settings.backups.toast.connectedGoogle"));
    if (error) toast.error(t("settings.backups.errors.oauth", { code: error }));
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
    void settingsQuery.refetch();
  }, [searchParams, setSearchParams, settingsQuery, t]);

  const busy = updateSettings.isPending || disconnect.isPending || runBackup.isPending || connectGitHub.isPending;
  const runBusy = runBackup.isPending || activeRun;

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.title")}</CardTitle>
          <CardDescription>{t("settings.backups.ownerOnlyNote")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.title")}</CardTitle>
          <CardDescription>{settingsQuery.error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (settingsQuery.isLoading || !settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.title")}</CardTitle>
          <CardDescription>{t("common.loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function saveSchedule(overrides: Partial<{
    enabled: boolean;
    frequency: "daily" | "weekly";
    weekday: number;
    retentionCount: number;
    includeFiles: boolean;
    localHour: number;
  }> = {}) {
    const hour = overrides.localHour ?? localHour;
    updateSettings.mutate({
      enabled: overrides.enabled ?? settings!.enabled,
      frequency: overrides.frequency ?? settings!.frequency,
      weekday: overrides.weekday ?? settings!.weekday,
      retentionCount: overrides.retentionCount ?? settings!.retentionCount,
      includeFiles: overrides.includeFiles ?? settings!.includeFiles,
      hourUtc: localHourToUtcHour(hour, timeZone),
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.title")}</CardTitle>
          <CardDescription>{t("settings.backups.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">{t("settings.backups.destination")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-lg border p-4 text-left transition-colors ${
                  providerDraft === "google_drive" ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => setProviderDraft("google_drive")}
              >
                <HardDrive className="mb-2 size-5" aria-hidden />
                <p className="font-medium">{t("settings.backups.providers.google")}</p>
              </button>
              <button
                type="button"
                className={`rounded-lg border p-4 text-left transition-colors ${
                  providerDraft === "github" ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => setProviderDraft("github")}
              >
                <FolderGit2 className="mb-2 size-5" aria-hidden />
                <p className="font-medium">{t("settings.backups.providers.github")}</p>
              </button>
            </div>
          </div>

          {providerDraft === "google_drive" ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              {settings.provider === "google_drive" && settings.credentialConnected ? (
                <>
                  <p className="text-sm">
                    {t("settings.backups.connectedAs", { email: settings.googleAccountEmail || "Google" })}
                  </p>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => disconnect.mutate()}>
                    {t("settings.backups.disconnect")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  disabled={busy || connectGoogle.isPending}
                  onClick={() => connectGoogle.mutate(i18n.language || "en")}
                >
                  {t("settings.backups.connectGoogle")}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-4">
              {settings.provider === "github" && settings.credentialConnected ? (
                <>
                  <p className="text-sm font-medium">{settings.githubRepo}</p>
                  <p className="text-xs text-muted-foreground">
                    {settings.githubBranch}/{settings.githubPath}
                  </p>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => disconnect.mutate()}>
                    {t("settings.backups.disconnect")}
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="backup-gh-repo">{t("settings.backups.github.repo")}</Label>
                    <Input
                      id="backup-gh-repo"
                      placeholder="owner/private-repo"
                      value={githubRepo}
                      onChange={(event) => setGithubRepo(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="backup-gh-branch">{t("settings.backups.github.branch")}</Label>
                      <Input
                        id="backup-gh-branch"
                        value={githubBranch}
                        onChange={(event) => setGithubBranch(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="backup-gh-path">{t("settings.backups.github.path")}</Label>
                      <Input
                        id="backup-gh-path"
                        value={githubPath}
                        onChange={(event) => setGithubPath(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="backup-gh-token">{t("settings.backups.github.token")}</Label>
                    <Input
                      id="backup-gh-token"
                      type="password"
                      autoComplete="off"
                      value={githubToken}
                      onChange={(event) => setGithubToken(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("settings.backups.github.tokenHelp")}{" "}
                      <a
                        className="text-primary underline"
                        href="https://github.com/settings/personal-access-tokens"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("settings.backups.github.tokenLink")}
                      </a>
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={busy || !githubRepo.trim() || !githubToken.trim()}
                    onClick={() =>
                      connectGitHub.mutate({
                        repo: githubRepo,
                        branch: githubBranch,
                        path: githubPath,
                        token: githubToken,
                      })
                    }
                  >
                    {t("settings.backups.connectGitHub")}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.schedule.title")}</CardTitle>
          <CardDescription>{t("settings.backups.schedule.description", { timeZone })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="backup-enabled">{t("settings.backups.schedule.enabled")}</Label>
            <Switch
              id="backup-enabled"
              checked={settings.enabled}
              disabled={busy || !settings.credentialConnected}
              onCheckedChange={(checked) => saveSchedule({ enabled: checked })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("settings.backups.schedule.frequency")}</Label>
              <Select
                value={settings.frequency}
                disabled={busy}
                onValueChange={(value) => saveSchedule({ frequency: value as "daily" | "weekly" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t("settings.backups.schedule.daily")}</SelectItem>
                  <SelectItem value="weekly">{t("settings.backups.schedule.weekly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settings.frequency === "weekly" ? (
              <div className="space-y-1.5">
                <Label>{t("settings.backups.schedule.weekday")}</Label>
                <Select
                  value={String(settings.weekday)}
                  disabled={busy}
                  onValueChange={(value) => saveSchedule({ weekday: Number(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {t(`settings.backups.schedule.weekdays.${day}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="backup-hour">{t("settings.backups.schedule.time")}</Label>
              <Select
                value={String(localHour)}
                disabled={busy}
                onValueChange={(value) => {
                  const next = Number(value);
                  setLocalHour(next);
                  saveSchedule({ localHour: next });
                }}
              >
                <SelectTrigger id="backup-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <SelectItem key={hour} value={String(hour)}>
                      {String(hour).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backup-retention">{t("settings.backups.schedule.retention")}</Label>
              <Input
                id="backup-retention"
                type="number"
                min={1}
                max={90}
                defaultValue={settings.retentionCount}
                disabled={busy}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value) || value < 1 || value > 90) return;
                  if (value === settings.retentionCount) return;
                  saveSchedule({ retentionCount: value });
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="backup-files">{t("settings.backups.schedule.includeFiles")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.backups.schedule.includeFilesHint")}</p>
            </div>
            <Switch
              id="backup-files"
              checked={settings.includeFiles}
              disabled={busy}
              onCheckedChange={(checked) => saveSchedule({ includeFiles: checked })}
            />
          </div>
          {settings.lastRunAt ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.backups.lastCopy")}: {new Date(settings.lastRunAt).toLocaleString()} · {settings.lastStatus}
              {settings.lastError ? ` — ${settings.lastError}` : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.actions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" disabled={runBusy} onClick={() => runBackup.mutate({ download: false })}>
            {t("settings.backups.actions.runNow")}
          </Button>
          <Button type="button" variant="outline" disabled={runBusy} onClick={() => runBackup.mutate({ download: true })}>
            {t("settings.backups.actions.download")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backups.history.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.backups.history.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.date")}</th>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.trigger")}</th>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.status")}</th>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.size")}</th>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.location")}</th>
                    <th className="px-2 py-1.5 font-medium">{t("settings.backups.history.error")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((run) => (
                    <tr key={run.id}>
                      <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                        {new Date(run.createdAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-2">
                        {run.trigger === "schedule"
                          ? t("settings.backups.history.triggerSchedule")
                          : t("settings.backups.history.triggerManual")}
                      </td>
                      <td className="px-2 py-2">{t(`settings.backups.status.${run.status}`)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatBackupSize(run.sizeBytes)}</td>
                      <td className="px-2 py-2">
                        {run.location ? (
                          <a
                            href={run.location}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {t("settings.backups.history.open")}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-[14rem] px-2 py-2 text-xs text-destructive [overflow-wrap:anywhere]">
                        {run.error || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
