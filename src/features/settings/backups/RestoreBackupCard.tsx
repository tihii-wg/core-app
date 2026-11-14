import { useId, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveRestore, CheckCircle2, FileArchive } from "lucide-react";
import { Button } from "../../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../ui/Card";
import { useConfirm } from "../../../ui/ConfirmProvider";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import {
  parseBackupFile,
  restoreBackup,
  type ParsedBackup,
  type RestoreProgress,
  type RestoreResult,
} from "../../../services/apiRestore";
import { useSetActiveWorkspace } from "../../workspaces/useSetActiveWorkspace";

function defaultName(parsed: ParsedBackup, locale: string, suffix: (date: string) => string) {
  const date = new Date(parsed.manifest.createdAt);
  const formatted = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
  return `${parsed.manifest.workspaceName} ${suffix(formatted)}`.trim();
}

/** Owner-only: restore a backup ZIP into a new workspace, leaving the current one untouched. */
export function RestoreBackupCard() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const inputId = useId();
  const { updateWorkspace, isPending: switching } = useSetActiveWorkspace();
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const running = progress != null && result == null;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setParsed(null);
    setResult(null);
    setProgress(null);
    setReading(true);
    try {
      const next = await parseBackupFile(file);
      setParsed(next);
      setName(defaultName(next, i18n.language, (date) => t("settings.backups.restore.nameSuffix", { date })));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.backups.restore.errors.generic"));
    } finally {
      setReading(false);
    }
  }

  async function onRestore() {
    if (!parsed) return;
    const ok = await confirm({
      title: t("settings.backups.restore.confirm.title"),
      description: t("settings.backups.restore.confirm.description", { name: name.trim() || parsed.manifest.workspaceName }),
      confirmLabel: t("settings.backups.restore.confirm.confirm"),
      icon: "warning",
    });
    if (!ok) return;
    setError(null);
    setResult(null);
    try {
      const next = await restoreBackup(parsed, name.trim(), setProgress);
      setResult(next);
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : t("settings.backups.restore.errors.generic"));
    }
  }

  const restoredRows = result ? Object.values(result.restored).reduce((sum, n) => sum + n, 0) : 0;
  const skippedTables = result ? Object.keys(result.skipped) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestore className="size-4 text-muted-foreground" aria-hidden />
          {t("settings.backups.restore.title")}
        </CardTitle>
        <CardDescription>{t("settings.backups.restore.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!running && !result ? (
          <div>
            <input id={inputId} type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => void onFile(e)} />
            <Button type="button" variant="outline" disabled={reading} onClick={() => document.getElementById(inputId)?.click()}>
              <FileArchive className="size-4" aria-hidden />
              {reading ? t("settings.backups.restore.reading") : t("settings.backups.restore.chooseFile")}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {parsed && !result ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("settings.backups.restore.info.workspace")}</dt>
                <dd className="font-medium">{parsed.manifest.workspaceName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("settings.backups.restore.info.createdAt")}</dt>
                <dd>{new Date(parsed.manifest.createdAt).toLocaleString(i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("settings.backups.restore.info.rows")}</dt>
                <dd className="tabular-nums">
                  {t("settings.backups.restore.info.rowsValue", { rows: parsed.totalRows, tables: parsed.manifest.tables.length })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("settings.backups.restore.info.files")}</dt>
                <dd className="tabular-nums">{parsed.fileEntries.length}</dd>
              </div>
            </dl>
            {!parsed.hasWorkspaceSettings ? (
              <p className="text-[13px] text-muted-foreground">{t("settings.backups.restore.oldFormatNote")}</p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={`${inputId}-name`}>{t("settings.backups.restore.newName")}</Label>
              <Input
                id={`${inputId}-name`}
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                disabled={running}
              />
            </div>

            {running && progress ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {progress.stage === "files"
                    ? t("settings.backups.restore.progress.files", { done: progress.done, total: progress.total })
                    : t(`settings.backups.restore.progress.${progress.stage}`)}
                </p>
                <ProgressBar
                  value={
                    progress.stage === "files" && progress.total > 0
                      ? 30 + Math.round((70 * progress.done) / progress.total)
                      : progress.stage === "data"
                        ? 20
                        : progress.stage === "finishing"
                          ? 98
                          : 5
                  }
                />
                <p className="text-[13px] text-muted-foreground">{t("settings.backups.restore.progress.keepOpen")}</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void onRestore()}>
                  <ArchiveRestore className="size-4" aria-hidden />
                  {t("settings.backups.restore.start")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setParsed(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              {t("settings.backups.restore.done.title", { name })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("settings.backups.restore.done.summary", {
                rows: restoredRows,
                files: result.filesDone,
                total: result.filesTotal,
              })}
            </p>
            {result.filesFailed > 0 ? (
              <p className="text-sm text-destructive">
                {t("settings.backups.restore.done.filesFailed", { count: result.filesFailed })}
              </p>
            ) : null}
            {skippedTables.length > 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("settings.backups.restore.done.reconnect")}</p>
            ) : null}
            <p className="text-[13px] text-muted-foreground">{t("settings.backups.restore.done.next")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={switching} onClick={() => void updateWorkspace(result.workspaceId)}>
                {t("settings.backups.restore.done.open")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setParsed(null);
                  setProgress(null);
                }}
              >
                {t("settings.backups.restore.done.close")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
