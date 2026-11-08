import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { PaymentStageMode, PaymentStageTemplateItem } from "./paymentStages";

const MODES: PaymentStageMode[] = ["percent", "amount", "remainder"];

export type PaymentStageTemplateIssue = "empty" | "nameRequired" | "percentOver" | "invalidValue" | null;

/** Light validation for the editor; returns the first blocking issue (or null). */
export function validatePaymentStageTemplate(items: readonly PaymentStageTemplateItem[]): PaymentStageTemplateIssue {
  if (items.length === 0) return "empty";
  if (items.some((item) => !item.name.trim())) return "nameRequired";
  let percentSum = 0;
  for (const item of items) {
    if (item.mode === "percent") {
      const percent = Number(item.percent ?? 0);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return "invalidValue";
      percentSum += percent;
    } else if (item.mode === "amount") {
      const amount = Number(item.amount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) return "invalidValue";
    }
    if (item.dueDays != null && (!Number.isFinite(Number(item.dueDays)) || Number(item.dueDays) < 0)) return "invalidValue";
  }
  if (percentSum > 100.005) return "percentOver";
  return null;
}

function defaultItemForMode(mode: PaymentStageMode, previous: PaymentStageTemplateItem): PaymentStageTemplateItem {
  return {
    ...previous,
    mode,
    percent: mode === "percent" ? (previous.percent ?? 0) : null,
    amount: mode === "amount" ? (previous.amount ?? 0) : null,
  };
}

function parseNumberInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type PaymentStageTemplateEditorProps = {
  value: PaymentStageTemplateItem[];
  onChange: (next: PaymentStageTemplateItem[]) => void;
  disabled?: boolean;
  idPrefix?: string;
};

/** Reusable editor for a payment-stage template (name, mode, percent/amount, due days). */
export function PaymentStageTemplateEditor({ value, onChange, disabled = false, idPrefix = "payment-stage" }: PaymentStageTemplateEditorProps) {
  const { t } = useTranslation();

  function patch(index: number, next: Partial<PaymentStageTemplateItem>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...next } : item)));
  }

  return (
    <div className="space-y-3">
      {value.map((item, index) => {
        const rowId = `${idPrefix}-${index}`;
        return (
          <div
            key={index}
            className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${rowId}-name`}>{t("settings.general.orders.paymentStages.stageName")}</Label>
              <Input
                id={`${rowId}-name`}
                value={item.name}
                disabled={disabled}
                onChange={(event) => patch(index, { name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${rowId}-mode`}>{t("settings.general.orders.paymentStages.mode")}</Label>
              <Select
                value={item.mode}
                disabled={disabled}
                onValueChange={(mode) => onChange(value.map((row, i) => (i === index ? defaultItemForMode(mode as PaymentStageMode, row) : row)))}
              >
                <SelectTrigger id={`${rowId}-mode`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`settings.general.orders.paymentStages.modes.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {item.mode === "percent" ? (
                <>
                  <Label htmlFor={`${rowId}-percent`}>{t("settings.general.orders.paymentStages.percent")}</Label>
                  <Input
                    id={`${rowId}-percent`}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    inputMode="decimal"
                    value={item.percent ?? ""}
                    disabled={disabled}
                    onChange={(event) => patch(index, { percent: parseNumberInput(event.target.value) })}
                  />
                </>
              ) : item.mode === "amount" ? (
                <>
                  <Label htmlFor={`${rowId}-amount`}>{t("settings.general.orders.paymentStages.amount")}</Label>
                  <Input
                    id={`${rowId}-amount`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={item.amount ?? ""}
                    disabled={disabled}
                    onChange={(event) => patch(index, { amount: parseNumberInput(event.target.value) })}
                  />
                </>
              ) : (
                <>
                  <Label>{t("settings.general.orders.paymentStages.value")}</Label>
                  <p className="flex h-9 items-center text-xs text-muted-foreground">
                    {t("settings.general.orders.paymentStages.remainderHint")}
                  </p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${rowId}-due`}>{t("settings.general.orders.paymentStages.dueDays")}</Label>
              <Input
                id={`${rowId}-due`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={item.dueDays ?? ""}
                disabled={disabled}
                onChange={(event) => {
                  const parsed = parseNumberInput(event.target.value);
                  patch(index, { dueDays: parsed == null ? null : Math.trunc(parsed) });
                }}
              />
            </div>
            {!disabled ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("settings.general.orders.paymentStages.removeStage")}
                disabled={value.length <= 1}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...value, { name: "", mode: value.some((i) => i.mode === "remainder") ? "percent" : "remainder", percent: null, amount: null, dueDays: null }])}
        >
          <Plus />
          {t("settings.general.orders.paymentStages.addStage")}
        </Button>
      ) : null}
    </div>
  );
}
