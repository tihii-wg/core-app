import { useState, type FormEvent } from "react";
import { DatabaseZap, Pencil, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { MAX_TAX_RATE_PERCENT, type TaxRecord } from "../../services/apiTaxes";
import { useCreateTax, useGetTaxes, useUpdateTax } from "../taxes/useTaxes";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";

type TaxForm = { name: string; rate: string; isIncluded: boolean; isActive: boolean };

const emptyForm: TaxForm = { name: "", rate: "", isIncluded: true, isActive: true };

function formFromTax(tax: TaxRecord): TaxForm {
  return { name: tax.name, rate: String(tax.rate), isIncluded: tax.isIncluded, isActive: tax.isActive };
}

/** Settings → Taxes: list/create/update `taxes` rows. Degrades to a notice when the table is not applied. */
export function TaxesSettings() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useGetTaxes();
  const canEdit = useCanEditWorkspaceSettings(useActiveWorkspaceRole());
  const createTax = useCreateTax();
  const updateTax = useUpdateTax();
  const [form, setForm] = useState<TaxForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const taxes = data?.taxes ?? [];
  const busy = createTax.isPending || updateTax.isPending;
  const rate = Number(form.rate.replace(",", "."));
  const rateValid = form.rate.trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate <= MAX_TAX_RATE_PERCENT;

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !rateValid || busy) return;
    const input = { name: form.name, rate, isIncluded: form.isIncluded, isActive: form.isActive };
    if (editingId) updateTax.mutate({ id: editingId, input }, { onSuccess: reset });
    else createTax.mutate(input, { onSuccess: reset });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.taxes.title")}</CardTitle>
        <CardDescription>{t("settings.taxes.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.taxes.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {data?.isUnavailable ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <DatabaseZap aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("settings.taxes.unavailable")}
          </p>
        ) : null}
        {!isLoading && !error && data && !data.isUnavailable && taxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.taxes.empty")}</p>
        ) : null}

        {taxes.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {taxes.map((tax) => (
              <li key={tax.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {tax.name} · <span className="tabular-nums">{tax.rate}%</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tax.isIncluded ? t("settings.taxes.included") : t("settings.taxes.excluded")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 text-xs text-muted-foreground">
                    {tax.isActive ? t("settings.taxes.active") : t("settings.taxes.inactive")}
                  </span>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t("settings.taxes.edit")}
                      title={t("settings.taxes.edit")}
                      onClick={() => {
                        setEditingId(tax.id);
                        setForm(formFromTax(tax));
                      }}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit && data && !data.isUnavailable ? (
          <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-medium text-foreground sm:col-span-2">
              {editingId ? t("settings.taxes.form.editTitle") : t("settings.taxes.form.title")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="tax-name">{t("settings.taxes.form.name")}</Label>
              <Input
                id="tax-name"
                value={form.name}
                required
                maxLength={120}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax-rate">{t("settings.taxes.form.rate")}</Label>
              <Input
                id="tax-rate"
                inputMode="decimal"
                placeholder="20"
                value={form.rate}
                required
                aria-invalid={form.rate.trim() !== "" && !rateValid}
                onChange={(event) => setForm({ ...form, rate: event.target.value })}
              />
              {form.rate.trim() !== "" && !rateValid ? (
                <p className="text-xs text-destructive">{t("settings.taxes.errors.rateRange", { max: MAX_TAX_RATE_PERCENT })}</p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isIncluded}
                onChange={(event) => setForm({ ...form, isIncluded: event.target.checked })}
              />
              {t("settings.taxes.form.isIncluded")}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              {t("settings.taxes.form.isActive")}
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || !form.name.trim() || !rateValid}>
                {editingId ? null : <Plus />}
                {busy ? t("common.saving") : editingId ? t("settings.taxes.form.save") : t("settings.taxes.form.submit")}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" disabled={busy} onClick={reset}>
                  <X />
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.taxes.note")}</p>
      </CardContent>
    </Card>
  );
}
