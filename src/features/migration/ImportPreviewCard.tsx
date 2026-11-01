import { useId, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/Table";
import { importEntities, importFieldDefs, type ImportEntity } from "./importMapping";
import {
  ImportParseError,
  buildImportPreview,
  importApplyBlockers,
  type ImportIssue,
  type ImportPreviewResult,
  type ImportPreviewRow,
} from "./importPreview";

const ACCEPT = ".csv,.json,text/csv,application/json";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ISSUE_LIMIT = 50;
const ROW_LIMIT = 25;

/** Lookup for `settings.migration.import.fields.*` — field keys are runtime strings, so cast past the i18n key union. */
function importFieldLabel(t: TFunction, key: string) {
  return t(`settings.migration.import.fields.${key}` as never, { defaultValue: key }) as string;
}

type LoadedFile = { name: string; size: number; text: string };

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * RO App import PREVIEW (docs/ro-app-migration.md §7). The file is read in the browser and analysed in memory:
 * nothing is uploaded, nothing is written, and "Apply import" stays disabled (no sandbox RPC exists yet).
 */
export function ImportPreviewCard() {
  const { t } = useTranslation();
  const fileInputId = useId();
  const entityId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<ImportEntity>("clients");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cheap and synchronous (capped at MAX_IMPORT_ROWS), so derive it instead of storing it.
  let result: ImportPreviewResult | null = null;
  let parseError: string | null = null;
  if (file) {
    try {
      result = buildImportPreview(entity, file.text, file.name);
    } catch (caught) {
      parseError = caught instanceof ImportParseError ? t(`settings.migration.import.parseErrors.${caught.code}`) : t("settings.migration.import.parseErrors.unknown");
    }
  }

  function reset() {
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFile(list: FileList | null) {
    setError(null);
    const next = list?.[0];
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setFile(null);
      setError(t("settings.migration.import.tooLarge", { size: formatSize(MAX_FILE_BYTES) }));
      return;
    }
    try {
      setFile({ name: next.name, size: next.size, text: await next.text() });
    } catch {
      setFile(null);
      setError(t("settings.migration.import.readFailed"));
    }
  }

  const blockers = importApplyBlockers(result);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.migration.import.title")}</CardTitle>
        <CardDescription>{t("settings.migration.import.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={entityId}>{t("settings.migration.import.entity")}</Label>
            <Select value={entity} onValueChange={(value: string) => setEntity(value as ImportEntity)}>
              <SelectTrigger id={entityId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {importEntities.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`settings.migration.import.entities.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={fileInputId}>{t("settings.migration.import.file")}</Label>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              onChange={(event) => void onFile(event.target.files)}
            />
            <p className="text-xs text-muted-foreground">{t("settings.migration.import.formats")}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("settings.migration.import.expected", {
            fields: importFieldDefs[entity].map((def) => `${importFieldLabel(t, def.key)}${def.required ? "*" : ""}`).join(", "),
          })}
        </p>

        {file ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
            <Upload aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-all font-medium text-foreground">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={reset}>
              <X />
              {t("settings.migration.import.clear")}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}

        {result ? <ImportReport result={result} /> : null}

        <div className="space-y-2 border-t border-border pt-4">
          <Button type="button" disabled aria-describedby={`${entityId}-apply`}>
            <Lock />
            {t("settings.migration.import.apply")}
          </Button>
          <div id={`${entityId}-apply`} className="space-y-1 text-xs text-muted-foreground">
            <p>{t("settings.migration.import.applyBlocked")}</p>
            <ul className="list-disc pl-4">
              {blockers.map((blocker) => (
                <li key={blocker}>{t(`settings.migration.import.blockers.${blocker}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportReport({ result }: { result: ImportPreviewResult }) {
  const { t } = useTranslation();
  const issues = [...result.errors, ...result.warnings].sort((a, b) => a.row - b.row);
  const fields = importFieldDefs[result.entity];
  const previewRows = result.rows.slice(0, ROW_LIMIT);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" aria-label={t("settings.migration.import.counts.label")}>
        <Badge variant="outline">{result.format.toUpperCase()}</Badge>
        <Badge variant="secondary">{t("settings.migration.import.counts.total", { count: result.counts.total })}</Badge>
        <Badge variant="outline">{t("settings.migration.import.counts.ok", { count: result.counts.ok })}</Badge>
        <Badge variant="outline">{t("settings.migration.import.counts.warning", { count: result.counts.warning })}</Badge>
        <Badge variant={result.counts.error > 0 ? "destructive" : "outline"}>
          {t("settings.migration.import.counts.error", { count: result.counts.error })}
        </Badge>
      </div>

      {result.unknownColumns.length > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle className="line-clamp-none whitespace-normal">
            {t("settings.migration.import.unknown.title", { count: result.unknownColumns.length })}
          </AlertTitle>
          <AlertDescription>
            <p>{t("settings.migration.import.unknown.body")}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {result.unknownColumns.map((column) => (
                <li key={column}>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{column}</code>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-2" aria-labelledby="import-columns">
        <h3 id="import-columns" className="text-sm font-medium text-foreground">
          {t("settings.migration.import.columns.title")}
        </h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.columns.map((column, index) => (
            <li key={`${column.header}-${index}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <code className="min-w-0 break-all text-xs text-foreground">{column.header}</code>
              {column.field ? (
                <span className="text-foreground">{importFieldLabel(t, column.field)}</span>
              ) : (
                <span className="text-xs text-muted-foreground">{t("settings.migration.import.columns.unknown")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {result.duplicateGroups.length > 0 ? (
        <section className="space-y-2" aria-labelledby="import-duplicates">
          <h3 id="import-duplicates" className="text-sm font-medium text-foreground">
            {t("settings.migration.import.duplicates.title", { count: result.duplicateGroups.length })}
          </h3>
          <p className="text-xs text-muted-foreground">{t("settings.migration.import.duplicates.hint")}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {result.duplicateGroups.slice(0, ISSUE_LIMIT).map((group) => (
              <li key={`${group.field}:${group.key}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge variant={group.severity === "error" ? "destructive" : "secondary"}>
                  {importFieldLabel(t, group.field)}
                </Badge>
                <code className="text-xs text-foreground">{group.key}</code>
                <span className="text-xs text-muted-foreground">
                  {t("settings.migration.import.duplicates.rows", { rows: group.rows.join(", ") })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2" aria-labelledby="import-issues">
        <h3 id="import-issues" className="text-sm font-medium text-foreground">
          {t("settings.migration.import.issues.title", { errors: result.errors.length, warnings: result.warnings.length })}
        </h3>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.migration.import.issues.none")}</p>
        ) : (
          <>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {issues.slice(0, ISSUE_LIMIT).map((issue, index) => (
                <IssueItem key={`${issue.row}-${issue.code}-${issue.field ?? ""}-${index}`} issue={issue} />
              ))}
            </ul>
            {issues.length > ISSUE_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.migration.import.issues.more", { shown: ISSUE_LIMIT, total: issues.length })}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="import-rows">
        <h3 id="import-rows" className="text-sm font-medium text-foreground">
          {t("settings.migration.import.rows.title", { shown: previewRows.length, total: result.rows.length })}
        </h3>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t("settings.migration.import.rows.status")}</TableHead>
                {fields.map((def) => (
                  <TableHead key={def.key}>{importFieldLabel(t, def.key)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row) => (
                <PreviewTableRow key={row.row} row={row} fieldKeys={fields.map((def) => def.key)} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function IssueItem({ issue }: { issue: ImportIssue }) {
  const { t } = useTranslation();
  // Column-level issues may carry a raw header (not a field key); fall back to the text itself.
  const field = issue.field ? importFieldLabel(t, issue.field) : "";
  return (
    <li className="flex flex-wrap items-start gap-2 px-4 py-2 text-sm">
      <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>
        {issue.row === 0 ? t("settings.migration.import.issues.file") : `#${issue.row}`}
      </Badge>
      <span className="min-w-0 flex-1 text-foreground">
        {t(`settings.migration.import.issues.codes.${issue.code}` as never, {
          field,
          value: issue.value ?? "",
          count: issue.count ?? 0,
        })}
      </span>
    </li>
  );
}

function PreviewTableRow({ row, fieldKeys }: { row: ImportPreviewRow; fieldKeys: string[] }) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="tabular-nums text-muted-foreground">{row.row}</TableCell>
      <TableCell>
        <Badge variant={row.status === "error" ? "destructive" : row.status === "warning" ? "secondary" : "outline"}>
          {t(`settings.migration.import.rows.statuses.${row.status}`)}
        </Badge>
      </TableCell>
      {fieldKeys.map((key) => (
        <TableCell key={key} className="max-w-48 truncate text-foreground" title={String(row.values[key] ?? "")}>
          {row.values[key] ?? <span className="text-muted-foreground">—</span>}
        </TableCell>
      ))}
    </TableRow>
  );
}
