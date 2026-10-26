import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../ui/Card";
import { Label } from "../../ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/Table";
import {
  CUSTOMER_DESTINATION_FIELDS,
  DEFAULT_CUSTOMER_MAPPINGS,
  DEFAULT_ORDER_MAPPINGS,
  DEMO_IMPORT_SUMMARY,
  formatDemoFileSize,
  IMPORT_DEMO_STEPS,
  importDemoProgressPercent,
  MOCK_CUSTOMER_SOURCE_COLUMNS,
  MOCK_CUSTOMERS,
  MOCK_ORDER_SOURCE_COLUMNS,
  MOCK_ORDERS,
  MOCK_VALIDATION_ISSUES,
  ORDER_DESTINATION_FIELDS,
  type CustomerDestinationField,
  type ImportDemoDataType,
  type ImportDemoStep,
  type OrderDestinationField,
} from "./importDemoData";

const ACCEPT = ".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

type SelectedDemoFile = {
  name: string;
  size: number;
};

function isAcceptedDemoFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

/**
 * Interactive Import Data demo. Local React state and mock rows only —
 * never reads file contents for import, never calls Supabase or create APIs.
 */
export function ImportDataDemo() {
  const { t } = useTranslation();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ImportDemoStep>("type");
  const [dataType, setDataType] = useState<ImportDemoDataType>("customers");
  const [file, setFile] = useState<SelectedDemoFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [customerMappings, setCustomerMappings] = useState({ ...DEFAULT_CUSTOMER_MAPPINGS });
  const [orderMappings, setOrderMappings] = useState({ ...DEFAULT_ORDER_MAPPINGS });
  const [isSimulating, setIsSimulating] = useState(false);

  const progress = importDemoProgressPercent(step);
  const showCustomers = dataType === "customers" || dataType === "both";
  const showOrders = dataType === "orders" || dataType === "both";
  const stepIndex = IMPORT_DEMO_STEPS.indexOf(step);

  function goTo(next: ImportDemoStep) {
    setStep(next);
  }

  function restart() {
    setStep("type");
    setDataType("customers");
    setFile(null);
    setFileError(null);
    setCustomerMappings({ ...DEFAULT_CUSTOMER_MAPPINGS });
    setOrderMappings({ ...DEFAULT_ORDER_MAPPINGS });
    setIsSimulating(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onFileChange(list: FileList | null) {
    setFileError(null);
    const next = list?.[0];
    if (!next) {
      setFile(null);
      return;
    }
    if (!isAcceptedDemoFile(next)) {
      setFile(null);
      setFileError(t("settings.import.upload.invalidType"));
      return;
    }
    // Metadata only — do not read or upload file contents.
    setFile({ name: next.name, size: next.size });
  }

  function canContinueFromUpload() {
    return file != null && !fileError;
  }

  async function runDemoImport() {
    if (isSimulating) return;
    setIsSimulating(true);
    goTo("result");
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    setIsSimulating(false);
  }

  return (
    <div className="min-w-0 space-y-5">
      <Alert className="border-amber-500/40 bg-amber-500/10 text-foreground">
        <AlertTriangle className="text-amber-600 dark:text-amber-400" />
        <AlertTitle className="line-clamp-none whitespace-normal">
          {t("settings.import.demoBanner.title")}
        </AlertTitle>
        <AlertDescription>{t("settings.import.demoBanner.description")}</AlertDescription>
      </Alert>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle>{t("settings.import.title")}</CardTitle>
              <CardDescription>{t("settings.import.description")}</CardDescription>
            </div>
            <Badge variant="secondary">{t("settings.import.demoBadge")}</Badge>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {t("settings.import.progress.label", {
                  current: stepIndex + 1,
                  total: IMPORT_DEMO_STEPS.length,
                })}
              </span>
              <span>{progress}%</span>
            </div>
            <DemoProgressBar value={progress} ariaLabel={t("settings.import.progress.aria")} />
            <ol className="flex flex-wrap gap-1.5 pt-1">
              {IMPORT_DEMO_STEPS.map((key, index) => {
                const active = index === stepIndex;
                const done = index < stepIndex;
                return (
                  <li key={key}>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                            ? "bg-muted text-foreground"
                            : "bg-muted/50 text-muted-foreground",
                      ].join(" ")}
                    >
                      {t(`settings.import.steps.${key}`)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-6">
          {step === "type" && (
            <section className="space-y-4" aria-labelledby="import-type-heading">
              <h3 id="import-type-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.type.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.type.description")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["customers", "settings.import.type.customers"],
                    ["orders", "settings.import.type.orders"],
                    ["both", "settings.import.type.both"],
                  ] as const
                ).map(([value, labelKey]) => {
                  const selected = dataType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDataType(value)}
                      className={[
                        "rounded-lg border px-4 py-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border hover:bg-muted/40",
                      ].join(" ")}
                      aria-pressed={selected}
                    >
                      <p className="text-sm font-medium text-foreground">{t(labelKey)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(`settings.import.type.${value}Hint`)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {step === "upload" && (
            <section className="space-y-4" aria-labelledby="import-upload-heading">
              <h3 id="import-upload-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.upload.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.upload.description")}</p>
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
                <FileSpreadsheet className="mx-auto mb-3 size-8 text-muted-foreground" />
                <Label htmlFor={fileInputId} className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
                  {t("settings.import.upload.choose")}
                </Label>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(event) => onFileChange(event.target.files)}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t("settings.import.upload.formats")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("settings.import.upload.localOnly")}</p>
              </div>
              {file && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <Upload className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-all font-medium text-foreground">{file.name}</span>
                  <span className="text-muted-foreground">({formatDemoFileSize(file.size)})</span>
                </div>
              )}
              {fileError && <p className="text-sm text-destructive">{fileError}</p>}
            </section>
          )}

          {step === "preview" && (
            <section className="space-y-4" aria-labelledby="import-preview-heading">
              <h3 id="import-preview-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.preview.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.preview.description")}</p>
              {showCustomers && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("settings.import.preview.customers")}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("settings.import.fields.customer.name")}</TableHead>
                        <TableHead>{t("settings.import.fields.customer.phone")}</TableHead>
                        <TableHead>{t("settings.import.fields.customer.email")}</TableHead>
                        <TableHead>{t("settings.import.fields.customer.address")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_CUSTOMERS.map((row) => (
                        <TableRow key={row.email}>
                          <TableCell className="whitespace-nowrap">{row.name}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.phone}</TableCell>
                          <TableCell className="max-w-[10rem] truncate">{row.email}</TableCell>
                          <TableCell className="max-w-[12rem] truncate">{row.address}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {showOrders && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("settings.import.preview.orders")}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("settings.import.fields.order.number")}</TableHead>
                        <TableHead>{t("settings.import.fields.order.date")}</TableHead>
                        <TableHead>{t("settings.import.fields.order.customer")}</TableHead>
                        <TableHead>{t("settings.import.fields.order.vehicle")}</TableHead>
                        <TableHead>{t("settings.import.fields.order.status")}</TableHead>
                        <TableHead>{t("settings.import.fields.order.total")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_ORDERS.map((row) => (
                        <TableRow key={row.number}>
                          <TableCell className="whitespace-nowrap">{row.number}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.date}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.customer}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.vehicle}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.status}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.total}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}

          {step === "mapping" && (
            <section className="space-y-5" aria-labelledby="import-mapping-heading">
              <h3 id="import-mapping-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.mapping.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.mapping.description")}</p>
              {showCustomers && (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("settings.import.mapping.customers")}
                  </p>
                  <div className="space-y-3">
                    {MOCK_CUSTOMER_SOURCE_COLUMNS.map((source) => (
                      <div
                        key={source}
                        className="grid gap-2 rounded-md border border-border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center"
                      >
                        <p className="min-w-0 break-words text-sm text-foreground">{source}</p>
                        <Select
                          value={customerMappings[source]}
                          onValueChange={(value: string) =>
                            setCustomerMappings((prev) => ({
                              ...prev,
                              [source]: value as CustomerDestinationField,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full" aria-label={t("settings.import.mapping.mapTo", { column: source })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CUSTOMER_DESTINATION_FIELDS.map((field) => (
                              <SelectItem key={field} value={field}>
                                {t(`settings.import.fields.customer.${field}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showOrders && (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("settings.import.mapping.orders")}
                  </p>
                  <div className="space-y-3">
                    {MOCK_ORDER_SOURCE_COLUMNS.map((source) => (
                      <div
                        key={source}
                        className="grid gap-2 rounded-md border border-border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center"
                      >
                        <p className="min-w-0 break-words text-sm text-foreground">{source}</p>
                        <Select
                          value={orderMappings[source]}
                          onValueChange={(value: string) =>
                            setOrderMappings((prev) => ({
                              ...prev,
                              [source]: value as OrderDestinationField,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full" aria-label={t("settings.import.mapping.mapTo", { column: source })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ORDER_DESTINATION_FIELDS.map((field) => (
                              <SelectItem key={field} value={field}>
                                {t(`settings.import.fields.order.${field}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {step === "validation" && (
            <section className="space-y-4" aria-labelledby="import-validation-heading">
              <h3 id="import-validation-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.validation.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.validation.description")}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label={t("settings.import.validation.stats.valid")} value={String(DEMO_IMPORT_SUMMARY.customersReady + DEMO_IMPORT_SUMMARY.ordersReady)} />
                <StatCard label={t("settings.import.validation.stats.duplicates")} value={String(DEMO_IMPORT_SUMMARY.duplicates)} />
                <StatCard label={t("settings.import.validation.stats.missing")} value={String(DEMO_IMPORT_SUMMARY.missingFields)} />
                <StatCard label={t("settings.import.validation.stats.unmatched")} value={String(DEMO_IMPORT_SUMMARY.unmatchedCustomers)} />
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {MOCK_VALIDATION_ISSUES.map((issue) => (
                  <li key={`${issue.row}-${issue.code}`} className="flex gap-3 px-3 py-3 text-sm">
                    {issue.severity === "info" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : issue.severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Info className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {t("settings.import.validation.rowLabel", { row: issue.row })} — {t(issue.messageKey)}
                      </p>
                      {issue.detail && <p className="text-muted-foreground">{issue.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === "confirm" && (
            <section className="space-y-4" aria-labelledby="import-confirm-heading">
              <h3 id="import-confirm-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.confirm.title")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("settings.import.confirm.description")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {showCustomers && (
                  <StatCard
                    label={t("settings.import.confirm.customersReady")}
                    value={String(DEMO_IMPORT_SUMMARY.customersReady)}
                  />
                )}
                {showOrders && (
                  <StatCard
                    label={t("settings.import.confirm.ordersReady")}
                    value={String(DEMO_IMPORT_SUMMARY.ordersReady)}
                  />
                )}
                <StatCard
                  label={t("settings.import.confirm.skipped")}
                  value={String(
                    (showCustomers ? DEMO_IMPORT_SUMMARY.customersSkipped : 0) +
                      (showOrders ? DEMO_IMPORT_SUMMARY.ordersSkipped : 0),
                  )}
                />
                <StatCard label={t("settings.import.confirm.file")} value={file?.name ?? "—"} />
              </div>
              <Alert>
                <Info />
                <AlertTitle>{t("settings.import.confirm.reminderTitle")}</AlertTitle>
                <AlertDescription>{t("settings.import.confirm.reminderBody")}</AlertDescription>
              </Alert>
            </section>
          )}

          {step === "result" && (
            <section className="space-y-4" aria-labelledby="import-result-heading">
              <h3 id="import-result-heading" className="text-sm font-medium text-foreground">
                {t("settings.import.result.title")}
              </h3>
              {isSimulating ? (
                <div className="space-y-3 rounded-lg border border-border px-4 py-8 text-center">
                  <div className="mx-auto max-w-xs">
                    <DemoProgressBar value={72} ariaLabel={t("settings.import.result.simulating")} />
                  </div>
                  <p className="text-sm text-muted-foreground">{t("settings.import.result.simulating")}</p>
                </div>
              ) : (
                <Alert className="border-emerald-500/40 bg-emerald-500/10">
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle className="line-clamp-none whitespace-normal">
                    {t("settings.import.result.demoCompleteTitle")}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{t("settings.import.result.demoCompleteBody")}</p>
                    <p className="mt-2 font-medium text-foreground">{t("settings.import.result.noRecordsSaved")}</p>
                  </AlertDescription>
                </Alert>
              )}
            </section>
          )}
        </CardContent>

        <CardFooter className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={restart} disabled={isSimulating}>
            <RotateCcw />
            {t("settings.import.actions.restart")}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {step !== "type" && step !== "result" && (
              <Button
                type="button"
                variant="outline"
                disabled={isSimulating}
                onClick={() => goTo(IMPORT_DEMO_STEPS[Math.max(0, stepIndex - 1)]!)}
              >
                {t("settings.import.actions.back")}
              </Button>
            )}
            {step === "type" && (
              <Button type="button" onClick={() => goTo("upload")}>
                {t("settings.import.actions.continue")}
              </Button>
            )}
            {step === "upload" && (
              <Button type="button" disabled={!canContinueFromUpload()} onClick={() => goTo("preview")}>
                {t("settings.import.actions.continue")}
              </Button>
            )}
            {step === "preview" && (
              <Button type="button" onClick={() => goTo("mapping")}>
                {t("settings.import.actions.continue")}
              </Button>
            )}
            {step === "mapping" && (
              <Button type="button" onClick={() => goTo("validation")}>
                {t("settings.import.actions.continue")}
              </Button>
            )}
            {step === "validation" && (
              <Button type="button" onClick={() => goTo("confirm")}>
                {t("settings.import.actions.continue")}
              </Button>
            )}
            {step === "confirm" && (
              <Button type="button" disabled={isSimulating} onClick={() => void runDemoImport()}>
                {t("settings.import.actions.runDemo")}
              </Button>
            )}
            {step === "result" && !isSimulating && (
              <Button type="button" onClick={restart}>
                {t("settings.import.actions.startOver")}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

/** Lightweight bar — avoids @radix-ui/react-progress (not in project deps). */
function DemoProgressBar({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20"
    >
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}
