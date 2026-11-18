import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Loader2, RotateCcw, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/Table";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { readSpreadsheet } from "../import/roSpreadsheet";
import { parseRoSheet, roParsedSummary, type RoImportKind, type RoParsed } from "../import/roImportParse";
import { runRoImport, type RoImportProgress, type RoImportResult } from "../../services/apiRoImport";

const ACCEPT =
  ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

const KINDS: RoImportKind[] = ["people", "organizations", "services", "materials", "orders"];

type Loaded = { fileName: string; headers: string[]; rows: unknown[][]; parsed: RoParsed | null };

function money(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/**
 * Real data import from RO App exports (.xls / .xlsx / .csv): the file is read in the browser, shown as a preview
 * and written through the import RPCs in chunks. Order of files: people → organisations → services → parts → orders.
 */
export function ImportDataSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const canEdit = useCanEditWorkspaceSettings(workspace?.role);
  const { data: warehouses = [] } = useGetWarehouses();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [kindOverride, setKindOverride] = useState<RoImportKind | null>(null);
  const [withBalances, setWithBalances] = useState(true);
  const [withPayments, setWithPayments] = useState(true);
  const [withStock, setWithStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [progress, setProgress] = useState<RoImportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RoImportResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive);
  const effectiveWarehouseId =
    warehouseId || activeWarehouses.find((warehouse) => warehouse.isDefault)?.id || activeWarehouses[0]?.id || "";

  const parsed = useMemo(() => {
    if (!loaded) return null;
    if (!kindOverride) return loaded.parsed;
    return parseRoSheet(loaded.headers, loaded.rows as never, kindOverride);
  }, [loaded, kindOverride]);
  const summary = parsed ? roParsedSummary(parsed) : null;

  function reset() {
    setLoaded(null);
    setReadError(null);
    setKindOverride(null);
    setProgress(null);
    setResult(null);
    setRunError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    reset();
    setReading(true);
    try {
      const table = await readSpreadsheet(file);
      setLoaded({
        fileName: file.name,
        headers: table.headers,
        rows: table.rows,
        parsed: parseRoSheet(table.headers, table.rows),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setReadError(message === "import:file_size" ? t("settings.importData.errors.fileSize") : t("settings.importData.errors.read"));
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    if (!parsed || running) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const done = await runRoImport(
        parsed,
        workspaceId,
        {
          withBalances,
          withPayments,
          stockWarehouseId: parsed.kind === "materials" && withStock ? effectiveWarehouseId || null : null,
        },
        setProgress,
      );
      setResult(done);
      // One refresh after the whole import (not per chunk).
      for (const key of ["clients", "vehicles", "services", "inventory", "inventory_items", "orders", "payments", "warehouse-stock", "dashboard"]) {
        void queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t("settings.importData.errors.failed"));
    } finally {
      setRunning(false);
    }
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const locale = i18n.language || "ru";

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            {t("settings.importData.title")}
          </CardTitle>
          <CardDescription>{t("settings.importData.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <Info />
            <AlertTitle className="line-clamp-none whitespace-normal">{t("settings.importData.orderTitle")}</AlertTitle>
            <AlertDescription>
              <ol className="list-decimal space-y-0.5 pl-4">
                {KINDS.map((kind) => (
                  <li key={kind}>{t(`settings.importData.kinds.${kind}`)}</li>
                ))}
              </ol>
              <p className="mt-2">{t("settings.importData.orderHint")}</p>
            </AlertDescription>
          </Alert>

          {!canEdit ? (
            <p className="text-sm text-muted-foreground">{t("settings.importData.ownerOnly")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                data-testid="import-file"
                disabled={reading || running}
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              <Button type="button" disabled={reading || running} onClick={() => fileInputRef.current?.click()}>
                {reading ? <Loader2 className="animate-spin" /> : <Upload />}
                {loaded ? t("settings.importData.chooseAnother") : t("settings.importData.chooseFile")}
              </Button>
              {loaded ? (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <FileSpreadsheet className="size-4 shrink-0" />
                  <span className="truncate">{loaded.fileName}</span>
                </span>
              ) : null}
              {loaded && !running ? (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw />
                  {t("settings.importData.reset")}
                </Button>
              ) : null}
            </div>
          )}

          {readError ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{readError}</AlertTitle>
            </Alert>
          ) : null}

          {loaded && !parsed ? (
            <div className="space-y-2">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle className="line-clamp-none whitespace-normal">{t("settings.importData.unknownFormat")}</AlertTitle>
              </Alert>
              <KindSelect value={kindOverride} onChange={setKindOverride} />
            </div>
          ) : null}

          {parsed && summary ? (
            <div className="space-y-4" data-testid="import-preview">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.importData.detectedKind")}</Label>
                  <KindSelect value={kindOverride ?? parsed.kind} onChange={setKindOverride} disabled={running} />
                </div>
              </div>

              <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <SummaryItem label={t("settings.importData.summary.rows")} value={String(summary.rows)} />
                {"vehicles" in summary ? (
                  <SummaryItem label={t("settings.importData.summary.vehicles")} value={String(summary.vehicles)} />
                ) : null}
                {"balances" in summary ? (
                  <SummaryItem label={t("settings.importData.summary.balances")} value={String(summary.balances)} />
                ) : null}
                {"withStock" in summary ? (
                  <SummaryItem label={t("settings.importData.summary.withStock")} value={String(summary.withStock)} />
                ) : null}
                {"lines" in summary ? (
                  <>
                    <SummaryItem label={t("settings.importData.summary.lines")} value={String(summary.lines)} />
                    <SummaryItem
                      label={t("settings.importData.summary.states")}
                      value={t("settings.importData.summary.statesValue", {
                        closed: summary.closed,
                        open: summary.open,
                        cancelled: summary.cancelled,
                      })}
                    />
                    <SummaryItem label={t("settings.importData.summary.paid")} value={money(summary.paidTotal ?? 0, locale)} />
                  </>
                ) : null}
                {parsed.rows.length < parsed.sourceRows ? (
                  <SummaryItem
                    label={t("settings.importData.summary.merged")}
                    value={String(parsed.sourceRows - parsed.rows.length)}
                  />
                ) : null}
              </ul>

              <PreviewTable parsed={parsed} locale={locale} />

              {parsed.issues.length > 0 ? (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>{t("settings.importData.issuesTitle", { count: parsed.issues.length })}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {parsed.issues.slice(0, 10).map((issue, index) => (
                        <li key={index}>
                          {t("settings.importData.issueRow", { row: issue.row })}{" "}
                          {issue.message.startsWith("unparsedLine:")
                            ? t("settings.importData.issues.unparsedLine", { text: issue.message.slice(13) })
                            : t(`settings.importData.issues.${issue.message}` as "settings.importData.issues.noName")}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-3 rounded-md border border-border p-3">
                {parsed.kind === "people" || parsed.kind === "organizations" ? (
                  <OptionSwitch
                    label={t("settings.importData.options.balances")}
                    hint={t("settings.importData.options.balancesHint")}
                    checked={withBalances}
                    disabled={running}
                    onChange={setWithBalances}
                  />
                ) : null}
                {parsed.kind === "materials" ? (
                  <>
                    <OptionSwitch
                      label={t("settings.importData.options.stock")}
                      hint={t("settings.importData.options.stockHint")}
                      checked={withStock}
                      disabled={running || activeWarehouses.length === 0}
                      onChange={setWithStock}
                    />
                    {withStock && activeWarehouses.length > 0 ? (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.importData.options.warehouse")}</Label>
                        <Select value={effectiveWarehouseId} onValueChange={setWarehouseId} disabled={running}>
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {activeWarehouses.map((warehouse) => (
                              <SelectItem key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {parsed.kind === "orders" ? (
                  <>
                    <OptionSwitch
                      label={t("settings.importData.options.payments")}
                      hint={t("settings.importData.options.paymentsHint")}
                      checked={withPayments}
                      disabled={running}
                      onChange={setWithPayments}
                    />
                    <p className="text-xs text-muted-foreground">{t("settings.importData.ordersRules")}</p>
                  </>
                ) : null}
                {parsed.kind === "services" ? (
                  <p className="text-xs text-muted-foreground">{t("settings.importData.catalogRules")}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">{t("settings.importData.rerunSafe")}</p>
              </div>

              {running || progress ? (
                <div className="space-y-1" aria-live="polite">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.importData.progress", { done: progress?.done ?? 0, total: progress?.total ?? parsed.rows.length })}
                  </p>
                </div>
              ) : null}

              {runError ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle className="line-clamp-none whitespace-normal">{runError}</AlertTitle>
                  <AlertDescription>{t("settings.importData.errors.partialHint")}</AlertDescription>
                </Alert>
              ) : null}

              {result ? (
                <Alert data-testid="import-result">
                  <CheckCircle2 />
                  <AlertTitle>{t("settings.importData.result.title")}</AlertTitle>
                  <AlertDescription>
                    <ul className="space-y-0.5">
                      <li>{t("settings.importData.result.created", { count: result.created })}</li>
                      {result.linked > 0 ? <li>{t("settings.importData.result.linked", { count: result.linked })}</li> : null}
                      {result.skipped > 0 ? <li>{t("settings.importData.result.skipped", { count: result.skipped })}</li> : null}
                      {result.duplicates > 0 ? (
                        <li>{t("settings.importData.result.duplicates", { count: result.duplicates })}</li>
                      ) : null}
                      {result.clients > 0 ? <li>{t("settings.importData.result.clients", { count: result.clients })}</li> : null}
                      {result.vehicles > 0 ? <li>{t("settings.importData.result.vehicles", { count: result.vehicles })}</li> : null}
                      {result.lines > 0 ? <li>{t("settings.importData.result.lines", { count: result.lines })}</li> : null}
                      {result.payments > 0 ? <li>{t("settings.importData.result.payments", { count: result.payments })}</li> : null}
                      {result.balances > 0 ? <li>{t("settings.importData.result.balances", { count: result.balances })}</li> : null}
                      {result.stockItems > 0 ? (
                        <li>{t("settings.importData.result.stockItems", { count: result.stockItems })}</li>
                      ) : null}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {canEdit ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    data-testid="import-run"
                    disabled={running || parsed.rows.length === 0 || Boolean(result)}
                    onClick={() => void runImport()}
                  >
                    {running ? <Loader2 className="animate-spin" /> : <Upload />}
                    {running
                      ? t("settings.importData.running")
                      : t("settings.importData.run", { count: parsed.rows.length })}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function KindSelect({
  value,
  onChange,
  disabled,
}: {
  value: RoImportKind | null;
  onChange: (kind: RoImportKind) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value ?? undefined} onValueChange={(next) => onChange(next as RoImportKind)} disabled={disabled}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder={t("settings.importData.pickKind")} />
      </SelectTrigger>
      <SelectContent>
        {KINDS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {t(`settings.importData.kinds.${kind}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </li>
  );
}

function OptionSwitch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function PreviewTable({ parsed, locale }: { parsed: RoParsed; locale: string }) {
  const { t } = useTranslation();
  const head = (key: string) => t(`settings.importData.columns.${key}` as "settings.importData.columns.name");
  const rows = parsed.rows.slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {t("settings.importData.previewCaption", { shown: rows.length, total: parsed.rows.length })}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            {parsed.kind === "orders" ? (
              <>
                <TableHead>{head("number")}</TableHead>
                <TableHead>{head("date")}</TableHead>
                <TableHead>{head("client")}</TableHead>
                <TableHead>{head("vehicle")}</TableHead>
                <TableHead>{head("lines")}</TableHead>
                <TableHead className="text-right">{head("total")}</TableHead>
                <TableHead>{head("status")}</TableHead>
              </>
            ) : parsed.kind === "services" ? (
              <>
                <TableHead>{head("name")}</TableHead>
                <TableHead className="text-right">{head("price")}</TableHead>
                <TableHead>{head("warranty")}</TableHead>
              </>
            ) : parsed.kind === "materials" ? (
              <>
                <TableHead>{head("name")}</TableHead>
                <TableHead>{head("sku")}</TableHead>
                <TableHead className="text-right">{head("cost")}</TableHead>
                <TableHead className="text-right">{head("price")}</TableHead>
                <TableHead className="text-right">{head("stock")}</TableHead>
              </>
            ) : (
              <>
                <TableHead>{head("name")}</TableHead>
                <TableHead>{head("phone")}</TableHead>
                <TableHead>{head("vehicle")}</TableHead>
                <TableHead className="text-right">{head("balance")}</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {parsed.kind === "orders"
            ? parsed.rows.slice(0, 8).map((row) => (
                <TableRow key={row.number}>
                  <TableCell className="font-medium">{row.number}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.created_at?.slice(0, 10) ?? "—"}</TableCell>
                  <TableCell>{row.client.name}</TableCell>
                  <TableCell>
                    {[row.vehicle?.make, row.vehicle?.model].filter(Boolean).join(" ") || "—"}
                    {row.vehicle?.plate ? <span className="text-muted-foreground"> · {row.vehicle.plate}</span> : null}
                  </TableCell>
                  <TableCell>{row.services.length + row.materials.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.total, locale)}</TableCell>
                  <TableCell>{row.status_name}</TableCell>
                </TableRow>
              ))
            : parsed.kind === "services"
              ? parsed.rows.slice(0, 8).map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.price, locale)}</TableCell>
                    <TableCell>{row.warranty_months > 0 ? t("settings.importData.months", { count: row.warranty_months }) : "—"}</TableCell>
                  </TableRow>
                ))
              : parsed.kind === "materials"
                ? parsed.rows.slice(0, 8).map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.sku ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.cost, locale)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.price, locale)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stock}</TableCell>
                    </TableRow>
                  ))
                : parsed.rows.slice(0, 8).map((row) => (
                    <TableRow key={row.source_id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.phone ?? "—"}</TableCell>
                      <TableCell>
                        {row.vehicles
                          .map((vehicle) => [vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(" "))
                          .join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.balance, locale)}</TableCell>
                    </TableRow>
                  ))}
        </TableBody>
      </Table>
    </div>
  );
}
