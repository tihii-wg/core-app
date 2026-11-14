import { useEffect, useMemo, useRef, useState } from "react";
import { HardDrive, FolderGit2, ExternalLink, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../ui/Card";
import { useConfirm } from "../../../ui/ConfirmProvider";
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

function providerLabelKey(provider: BackupProvider): "google" | "github" {
  return provider === "github" ? "github" : "google";
}

export function BackupsSettings() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
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
  const [providerDraft, setProviderDraft] = useState<BackupProvider | null>(null);
  const [pollWhileActive, setPollWhileActive] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    setProviderDraft(settings.provider);
    setGithubRepo(settings.githubRepo ?? "");
    setGithubBranch(settings.githubBranch ?? "main");
    setGithubPath(settings.githubPath ?? "core-app-backups");
    setLocalHour(utcHourToLocalHour(settings.hourUtc, timeZone));
  }, [settings, timeZone]);

  // Handle the redirect back from Google OAuth (?connected=google | ?error=…) exactly once.
  // `settingsQuery` is a new object on every render, so it must not be an effect dependency —
  // otherwise each re-render before the URL is cleaned fires the toast again.
  const handledOAuthReturn = useRef<string | null>(null);
  const refetchSettings = settingsQuery.refetch;
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;
    const marker = `${connected ?? ""}:${error ?? ""}`;
    if (handledOAuthReturn.current !== marker) {
      handledOAuthReturn.current = marker;
      if (connected === "google") toast.success(t("settings.backups.toast.connectedGoogle"), { id: "backup-oauth" });
      if (error) toast.error(t("settings.backups.errors.oauth", { code: error }), { id: "backup-oauth" });
      void refetchSettings();
    }
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
  }, [refetchSettings, searchParams, setSearchParams, t]);

  const busy =
    updateSettings.isPending || disconnect.isPending || runBackup.isPending || connectGitHub.isPending;
  const runBusy = runBackup.isPending || activeRun;
  const backupsEnabled = settings?.enabled === true;
  const providerConnected =
    Boolean(settings?.credentialConnected) &&
    settings?.provider != null &&
    providerDraft != null &&
    settings.provider === providerDraft;

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

  async function setEnabled(next: boolean) {
    if (!isOwner) return;
    if (!next && settings!.enabled) {
      const ok = await confirm({
        title: t("settings.backups.confirmDisable.title"),
        description: t("settings.backups.confirmDisable.description"),
        confirmLabel: t("settings.backups.confirmDisable.confirm"),
        tone: "destructive",
        icon: "warning",
      });
      if (!ok) return;
    }
    updateSettings.mutate({
      enabled: next,
      hourUtc: localHourToUtcHour(localHour, timeZone),
    });
  }

  async function selectProvider(next: BackupProvider) {
    if (!isOwner || busy) return;
    if (providerDraft === next) return;
    const otherConnected =
      settings!.credentialConnected && settings!.provider != null && settings!.provider !== next;
    if (otherConnected) {
      const ok = await confirm({
        title: t("settings.backups.confirmSwitchProvider.title"),
        description: t("settings.backups.confirmSwitchProvider.description", {
          current: t(`settings.backups.providers.${providerLabelKey(settings!.provider!)}`),
          next: t(`settings.backups.providers.${providerLabelKey(next)}`),
        }),
        confirmLabel: t("settings.backups.confirmSwitchProvider.confirm"),
        tone: "destructive",
        icon: "warning",
      });
      if (!ok) return;
      await disconnect.mutateAsync();
      setProviderDraft(next);
      updateSettings.mutate({ provider: next });
      return;
    }
    setProviderDraft(next);
    if (settings!.provider !== next) {
      updateSettings.mutate({ provider: next });
    }
  }

  function saveSchedule(
    overrides: Partial<{
      frequency: "daily" | "weekly";
      weekday: number;
      retentionCount: number;
      includeFiles: boolean;
      localHour: number;
    }> = {},
  ) {
    if (!isOwner || !providerConnected) return;
    const hour = overrides.localHour ?? localHour;
    updateSettings.mutate({
      enabled: true,
      frequency: overrides.frequency ?? settings!.frequency,
      weekday: overrides.weekday ?? settings!.weekday,
      retentionCount: overrides.retentionCount ?? settings!.retentionCount,
      includeFiles: overrides.includeFiles ?? settings!.includeFiles,
      hourUtc: localHourToUtcHour(hour, timeZone),
    });
  }

  function renderHistoryTable() {
    return (
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
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>{t("settings.backups.master.title")}</CardTitle>
              <CardDescription>{t("settings.backups.master.description")}</CardDescription>
              {!isOwner ? (
                <p className="text-sm text-muted-foreground">{t("settings.backups.ownerOnlyNote")}</p>
              ) : null}
            </div>
            <Switch
              id="backup-master-enabled"
              checked={backupsEnabled}
              disabled={!isOwner || busy}
              aria-label={t("settings.backups.master.title")}
              onCheckedChange={(checked) => {
                void setEnabled(checked);
              }}
            />
          </div>
        </CardHeader>
      </Card>

      {backupsEnabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.backups.destination")}</CardTitle>
              <CardDescription>{t("settings.backups.destinationHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!isOwner || busy}
                  className={`rounded-lg border p-4 text-left transition-colors disabled:opacity-60 ${
                    providerDraft === "google_drive" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onClick={() => {
                    void selectProvider("google_drive");
                  }}
                >
                  <HardDrive className="mb-2 size-5" aria-hidden />
                  <p className="font-medium">{t("settings.backups.providers.google")}</p>
                </button>
                <button
                  type="button"
                  disabled={!isOwner || busy}
                  className={`rounded-lg border p-4 text-left transition-colors disabled:opacity-60 ${
                    providerDraft === "github" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onClick={() => {
                    void selectProvider("github");
                  }}
                >
                  <FolderGit2 className="mb-2 size-5" aria-hidden />
                  <p className="font-medium">{t("settings.backups.providers.github")}</p>
                </button>
              </div>

              {providerDraft === "google_drive" ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  {settings.provider === "google_drive" && settings.credentialConnected ? (
                    <>
                      <p className="text-sm">
                        {t("settings.backups.connectedAs", {
                          email: settings.googleAccountEmail || "Google",
                        })}
                      </p>
                      {isOwner ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => disconnect.mutate()}
                        >
                          {t("settings.backups.disconnect")}
                        </Button>
                      ) : null}
                    </>
                  ) : isOwner ? (
                    <Button
                      type="button"
                      disabled={busy || connectGoogle.isPending}
                      onClick={() => connectGoogle.mutate(i18n.language || "en")}
                    >
                      {t("settings.backups.connectGoogle")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {providerDraft === "github" ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  {settings.provider === "github" && settings.credentialConnected ? (
                    <>
                      <p className="text-sm font-medium">{settings.githubRepo}</p>
                      <p className="text-xs text-muted-foreground">
                        {settings.githubBranch}/{settings.githubPath}
                      </p>
                      {isOwner ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => disconnect.mutate()}
                        >
                          {t("settings.backups.disconnect")}
                        </Button>
                      ) : null}
                    </>
                  ) : isOwner ? (
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
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {providerDraft ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.backups.schedule.title")}</CardTitle>
                  <CardDescription>
                    {t("settings.backups.schedule.description", { timeZone })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!providerConnected ? (
                    <p className="text-sm text-muted-foreground">
                      {t("settings.backups.connectProviderFirst", {
                        provider: t(`settings.backups.providers.${providerLabelKey(providerDraft)}`),
                      })}
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>{t("settings.backups.schedule.frequency")}</Label>
                      <Select
                        value={settings.frequency}
                        disabled={!isOwner || busy || !providerConnected}
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
                          disabled={!isOwner || busy || !providerConnected}
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
                        disabled={!isOwner || busy || !providerConnected}
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
                        disabled={!isOwner || busy || !providerConnected}
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
                      <p className="text-xs text-muted-foreground">
                        {t("settings.backups.schedule.includeFilesHint")}
                      </p>
                    </div>
                    <Switch
                      id="backup-files"
                      checked={settings.includeFiles}
                      disabled={!isOwner || busy || !providerConnected}
                      onCheckedChange={(checked) => saveSchedule({ includeFiles: checked })}
                    />
                  </div>
                  {settings.lastRunAt ? (
                    <p className="text-sm text-muted-foreground">
                      {t("settings.backups.lastCopy")}: {new Date(settings.lastRunAt).toLocaleString()} ·{" "}
                      {settings.lastStatus}
                      {settings.lastError ? ` — ${settings.lastError}` : ""}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.backups.actions.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!providerConnected ? (
                    <p className="text-sm text-muted-foreground">
                      {t("settings.backups.connectProviderFirst", {
                        provider: t(`settings.backups.providers.${providerLabelKey(providerDraft)}`),
                      })}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={!isOwner || runBusy || !providerConnected}
                      onClick={() => runBackup.mutate({ download: false })}
                    >
                      {t("settings.backups.actions.runNow")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!isOwner || runBusy || !providerConnected}
                      onClick={() => runBackup.mutate({ download: true })}
                    >
                      {t("settings.backups.actions.download")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}

          {history.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.backups.history.title")}</CardTitle>
              </CardHeader>
              <CardContent>{renderHistoryTable()}</CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        history.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <CardTitle>{t("settings.backups.history.collapsedTitle")}</CardTitle>
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                    historyOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </button>
            </CardHeader>
            {historyOpen ? <CardContent>{renderHistoryTable()}</CardContent> : null}
          </Card>
        ) : null
      )}
    </div>
  );
}
