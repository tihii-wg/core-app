import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import type { MigrationPreviewRow } from "../../services/apiMigrationPreview";
import {
  migrationChecklistProgress,
  migrationChecklistSteps,
  migrationPreviewGroups,
  migrationProdSteps,
  type MigrationChecklistStep,
} from "./migrationChecklist";
import { ImportPreviewCard } from "./ImportPreviewCard";
import { useMigrationPreview } from "./useMigrationPreview";

/**
 * Stages 7–8 foundation: a dry-run checklist plus read-only row counts of THIS Core App workspace.
 * The import card analyses a local CSV/JSON file in memory (dry run). Nothing here reads RO App, writes data, or sends SMS/email.
 */
export function MigrationSettings() {
  const { t } = useTranslation();
  const [done, setDone] = useState<ReadonlySet<MigrationChecklistStep>>(new Set());
  const progress = migrationChecklistProgress(done);

  function toggle(step: MigrationChecklistStep) {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  return (
    <div className="min-w-0 space-y-5">
      <Alert>
        <ShieldCheck />
        <AlertTitle className="line-clamp-none whitespace-normal">{t("settings.migration.safety.title")}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-4">
            <li>{t("settings.migration.safety.noRoWrites")}</li>
            <li>{t("settings.migration.safety.noMessages")}</li>
            <li>{t("settings.migration.safety.coreOnly")}</li>
            <li>{t("settings.migration.safety.noSql")}</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle>{t("settings.migration.checklist.title")}</CardTitle>
              <CardDescription>{t("settings.migration.checklist.description")}</CardDescription>
            </div>
            <Badge variant="secondary">
              {t("settings.migration.checklist.progress", { completed: progress.completed, total: progress.total })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="divide-y divide-border rounded-lg border border-border">
            {migrationChecklistSteps.map((step, index) => (
              <ChecklistItem
                key={step}
                step={step}
                index={index + 1}
                checked={done.has(step)}
                isProd={migrationProdSteps.includes(step)}
                onToggle={() => toggle(step)}
              />
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{t("settings.migration.checklist.localNote")}</p>
        </CardContent>
      </Card>

      <MigrationPreviewCard />

      <ImportPreviewCard />
    </div>
  );
}

function ChecklistItem({
  step,
  index,
  checked,
  isProd,
  onToggle,
}: {
  step: MigrationChecklistStep;
  index: number;
  checked: boolean;
  isProd: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input id={id} type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={checked} onChange={onToggle} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {index}. {t(`settings.migration.steps.${step}.title`)}
          <Badge variant={isProd ? "destructive" : "outline"}>
            {isProd ? t("settings.migration.checklist.prod") : t("settings.migration.checklist.test")}
          </Badge>
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">{t(`settings.migration.steps.${step}.body`)}</span>
      </label>
    </li>
  );
}

function MigrationPreviewCard() {
  const { t } = useTranslation();
  const { data: rows = [], isLoading, isFetching, error, refetch } = useMigrationPreview();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>{t("settings.migration.preview.title")}</CardTitle>
            <CardDescription>{t("settings.migration.preview.description")}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            {t("settings.migration.preview.refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.migration.preview.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error
          ? migrationPreviewGroups.map((group) => {
              const groupRows = rows.filter((row) => row.group === group);
              if (groupRows.length === 0) return null;
              return (
                <section key={group} className="space-y-2" aria-labelledby={`migration-group-${group}`}>
                  <h3 id={`migration-group-${group}`} className="text-sm font-medium text-foreground">
                    {t(`settings.migration.preview.groups.${group}.title`)}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t(`settings.migration.preview.groups.${group}.hint`)}</p>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {groupRows.map((row) => (
                      <PreviewRow key={row.table} row={row} />
                    ))}
                  </ul>
                </section>
              );
            })
          : null}
      </CardContent>
    </Card>
  );
}

function PreviewRow({ row }: { row: MigrationPreviewRow }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <code className="text-xs text-foreground">{row.table}</code>
      {row.status === "ok" ? (
        <span className="text-sm font-semibold tabular-nums text-foreground">{row.count}</span>
      ) : (
        <span className="text-xs text-muted-foreground" title={row.message}>
          {t(`settings.migration.preview.status.${row.status}`)}
        </span>
      )}
    </li>
  );
}
