import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Building, CreditCard, FileText, Save, Shield, Trash2, Users } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { EmptyState } from "../../ui/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import {
  useUpdateWorkspaceContactSettings,
  useUpdateWorkspaceInvoiceSettings,
  useUpdateWorkspaceOrderSettings,
} from "../workspaces/useUpdateWorkspace";
import { getWorkspaceInvoiceNextNumber, type WorkspaceDetails } from "../../services/apiWorkspaces";
import {
  isValidInvoiceNumberTemplate,
  normalizeInvoiceDueDays,
  normalizeInvoiceNumberTemplate,
  normalizeInvoiceOrderDetailsMode,
  normalizeVisibility,
  normalizeWarrantyStart,
  type InvoiceOrderDetailsMode,
  type VisibilityDefault,
  type WarrantyStart,
} from "../../lib/workspaceGeneralSettings";
import { useCreateLegalEntity, useDeleteLegalEntity, useLegalEntities, useUpdateLegalEntity } from "./useLegalEntities";
import type { LegalEntity, LegalEntityInput } from "../../services/apiLegalEntities";

function SettingRow({ label, description, control }: { label: string; description?: string; control: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function OrdersSettingsCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  const { mutateAsync: save, isPending } = useUpdateWorkspaceOrderSettings();
  const [warrantyStart, setWarrantyStart] = useState<WarrantyStart>(normalizeWarrantyStart(workspace.warrantyStart));
  const [comments, setComments] = useState<VisibilityDefault>(normalizeVisibility(workspace.defaultCommentsVisibility));
  const [files, setFiles] = useState<VisibilityDefault>(normalizeVisibility(workspace.defaultFilesVisibility));
  const [preventDevice, setPreventDevice] = useState(workspace.preventDuplicateDeviceOrders);

  async function onSave() {
    toast.loading(t("settings.general.orders.toast.saving"), { id: "orders-settings" });
    try {
      await save({
        workspaceId: workspace.id,
        warrantyStart,
        defaultCommentsVisibility: comments,
        defaultFilesVisibility: files,
        preventDuplicateDeviceOrders: preventDevice,
      });
      toast.success(t("settings.general.orders.toast.saved"), { id: "orders-settings" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.orders.toast.failed"), { id: "orders-settings" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.orders.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.orders.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="warranty-start">{t("settings.general.orders.warrantyStart")}</Label>
          <Select value={warrantyStart} onValueChange={(v) => setWarrantyStart(normalizeWarrantyStart(v))} disabled={!canEdit || isPending}>
            <SelectTrigger id="warranty-start" className="w-full md:max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">{t("settings.general.orders.warrantyFromCreated")}</SelectItem>
              <SelectItem value="closed_at">{t("settings.general.orders.warrantyFromClosed")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("settings.general.orders.warrantyHint")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="comments-visibility">{t("settings.general.orders.commentsVisibility")}</Label>
            <Select value={comments} onValueChange={(v) => setComments(normalizeVisibility(v))} disabled={!canEdit || isPending}>
              <SelectTrigger id="comments-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">{t("settings.general.visibility.private")}</SelectItem>
                <SelectItem value="public">{t("settings.general.visibility.public")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="files-visibility">{t("settings.general.orders.filesVisibility")}</Label>
            <Select value={files} onValueChange={(v) => setFiles(normalizeVisibility(v))} disabled={!canEdit || isPending}>
              <SelectTrigger id="files-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">{t("settings.general.visibility.private")}</SelectItem>
                <SelectItem value="public">{t("settings.general.visibility.public")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.general.orders.visibilityHint")}</p>

        <SettingRow
          label={t("settings.general.orders.preventDuplicateDevice")}
          description={t("settings.general.orders.preventDuplicateDeviceHint")}
          control={<Switch checked={preventDevice} onCheckedChange={setPreventDevice} disabled={!canEdit || isPending} aria-label={t("settings.general.orders.preventDuplicateDevice")} />}
        />

        {canEdit ? (
          <div className="flex justify-end border-t border-border pt-5">
            <Button type="button" onClick={() => void onSave()} disabled={isPending}>
              <Save />
              {isPending ? t("common.saving") : t("settings.general.orders.save")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ContactsSettingsCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  const { mutateAsync: save, isPending } = useUpdateWorkspaceContactSettings();
  const [showMiddleName, setShowMiddleName] = useState(workspace.showClientMiddleName);
  const [phoneConsent, setPhoneConsent] = useState(workspace.defaultPhoneConsent);
  const [preventPhone, setPreventPhone] = useState(workspace.preventDuplicatePhones);
  const [emailConsent, setEmailConsent] = useState(workspace.defaultEmailConsent);
  const [preventEmail, setPreventEmail] = useState(workspace.preventDuplicateEmails);

  async function onSave() {
    toast.loading(t("settings.general.contacts.toast.saving"), { id: "contacts-settings" });
    try {
      await save({
        workspaceId: workspace.id,
        showClientMiddleName: showMiddleName,
        defaultPhoneConsent: phoneConsent,
        preventDuplicatePhones: preventPhone,
        defaultEmailConsent: emailConsent,
        preventDuplicateEmails: preventEmail,
      });
      toast.success(t("settings.general.contacts.toast.saved"), { id: "contacts-settings" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.contacts.toast.failed"), { id: "contacts-settings" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.contacts.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.contacts.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingRow
          label={t("settings.general.contacts.showMiddleName")}
          control={<Switch checked={showMiddleName} onCheckedChange={setShowMiddleName} disabled={!canEdit || isPending} aria-label={t("settings.general.contacts.showMiddleName")} />}
        />
        <SettingRow
          label={t("settings.general.contacts.defaultPhoneConsent")}
          control={<Switch checked={phoneConsent} onCheckedChange={setPhoneConsent} disabled={!canEdit || isPending} aria-label={t("settings.general.contacts.defaultPhoneConsent")} />}
        />
        <SettingRow
          label={t("settings.general.contacts.preventDuplicatePhones")}
          description={t("settings.general.contacts.preventDuplicateHint")}
          control={<Switch checked={preventPhone} onCheckedChange={setPreventPhone} disabled={!canEdit || isPending} aria-label={t("settings.general.contacts.preventDuplicatePhones")} />}
        />
        <SettingRow
          label={t("settings.general.contacts.defaultEmailConsent")}
          control={<Switch checked={emailConsent} onCheckedChange={setEmailConsent} disabled={!canEdit || isPending} aria-label={t("settings.general.contacts.defaultEmailConsent")} />}
        />
        <SettingRow
          label={t("settings.general.contacts.preventDuplicateEmails")}
          description={t("settings.general.contacts.preventDuplicateHint")}
          control={<Switch checked={preventEmail} onCheckedChange={setPreventEmail} disabled={!canEdit || isPending} aria-label={t("settings.general.contacts.preventDuplicateEmails")} />}
        />

        {canEdit ? (
          <div className="flex justify-end border-t border-border pt-5">
            <Button type="button" onClick={() => void onSave()} disabled={isPending}>
              <Save />
              {isPending ? t("common.saving") : t("settings.general.contacts.save")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesSettingsCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  const { mutateAsync: save, isPending } = useUpdateWorkspaceInvoiceSettings();
  const { data: entities = [] } = useLegalEntities(workspace.id);
  const [template, setTemplate] = useState(normalizeInvoiceNumberTemplate(workspace.invoiceNumberTemplate));
  const [nextNumber, setNextNumber] = useState("1");
  const [loadedNextNumber, setLoadedNextNumber] = useState<string | null>(null);
  const [dueDays, setDueDays] = useState(String(normalizeInvoiceDueDays(workspace.invoiceDueDays)));
  const [mode, setMode] = useState<InvoiceOrderDetailsMode>(normalizeInvoiceOrderDetailsMode(workspace.invoiceOrderDetailsMode));
  const [preventBackdated, setPreventBackdated] = useState(workspace.preventBackdatedInvoices);
  const [legalEntityId, setLegalEntityId] = useState(workspace.defaultLegalEntityId ?? "");

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceInvoiceNextNumber(workspace.id)
      .then((value) => {
        if (!cancelled) {
          setNextNumber(String(value));
          setLoadedNextNumber(String(value));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNextNumber("1");
          setLoadedNextNumber("1");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  async function onSave() {
    const next = Math.round(Number(nextNumber));
    if (!Number.isFinite(next) || next < 1) {
      toast.error(t("settings.general.invoices.validation.nextNumber"), { id: "invoice-settings" });
      return;
    }
    const days = normalizeInvoiceDueDays(dueDays);
    // M8: validate the RAW template the user typed. Invalid input is
    // reported, never silently replaced with the default.
    if (!isValidInvoiceNumberTemplate(template)) {
      toast.error(t("settings.general.invoices.validation.templateCounter"), { id: "invoice-settings" });
      return;
    }

    // H5: seed the counter only when the user intentionally changed
    // the next-number field; other saves must not touch numbering.
    const nextChanged = loadedNextNumber !== null && String(next) !== loadedNextNumber;

    toast.loading(t("settings.general.invoices.toast.saving"), { id: "invoice-settings" });
    try {
      await save({
        workspaceId: workspace.id,
        invoiceNumberTemplate: template.trim(),
        invoiceDueDays: days,
        invoiceOrderDetailsMode: mode,
        preventBackdatedInvoices: preventBackdated,
        defaultLegalEntityId: legalEntityId || null,
        ...(nextChanged ? { invoiceNextNumber: next } : {}),
      });
      if (nextChanged) setLoadedNextNumber(String(next));
      toast.success(t("settings.general.invoices.toast.saved"), { id: "invoice-settings" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.invoices.toast.failed"), { id: "invoice-settings" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.invoices.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.invoices.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="invoice-template">{t("settings.general.invoices.template")}</Label>
            <Input id="invoice-template" value={template} onChange={(e) => setTemplate(e.target.value)} disabled={!canEdit || isPending} className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t("settings.general.invoices.templateHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-next">{t("settings.general.invoices.nextNumber")}</Label>
            <Input id="invoice-next" type="number" min={1} value={nextNumber} onChange={(e) => setNextNumber(e.target.value)} disabled={!canEdit || isPending} />
            <p className="text-xs text-muted-foreground">{t("settings.general.invoices.nextNumberHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-due-days">{t("settings.general.invoices.dueDays")}</Label>
            <Input id="invoice-due-days" type="number" min={0} max={3650} value={dueDays} onChange={(e) => setDueDays(e.target.value)} disabled={!canEdit || isPending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-order-mode">{t("settings.general.invoices.orderDetailsMode")}</Label>
            <Select value={mode} onValueChange={(v) => setMode(normalizeInvoiceOrderDetailsMode(v))} disabled={!canEdit || isPending}>
              <SelectTrigger id="invoice-order-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="detailed">{t("settings.general.invoices.modes.detailed")}</SelectItem>
                <SelectItem value="simplified">{t("settings.general.invoices.modes.simplified")}</SelectItem>
                <SelectItem value="one_line">{t("settings.general.invoices.modes.oneLine")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("settings.general.invoices.orderDetailsModeHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-legal-entity">{t("settings.general.invoices.defaultLegalEntity")}</Label>
            <Select value={legalEntityId || "__none__"} onValueChange={(v) => setLegalEntityId(v === "__none__" ? "" : v)} disabled={!canEdit || isPending}>
              <SelectTrigger id="invoice-legal-entity" className="w-full">
                <SelectValue placeholder={t("settings.general.invoices.noLegalEntity")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("settings.general.invoices.noLegalEntity")}</SelectItem>
                {entities.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.legalName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("settings.general.invoices.defaultLegalEntityHint")}</p>
          </div>
        </div>

        <SettingRow
          label={t("settings.general.invoices.preventBackdated")}
          description={t("settings.general.invoices.preventBackdatedHint")}
          control={<Switch checked={preventBackdated} onCheckedChange={setPreventBackdated} disabled={!canEdit || isPending} aria-label={t("settings.general.invoices.preventBackdated")} />}
        />

        <p className="text-xs text-muted-foreground">{t("settings.general.invoices.creditNotesNote")}</p>

        {canEdit ? (
          <div className="flex justify-end border-t border-border pt-5">
            <Button type="button" onClick={() => void onSave()} disabled={isPending}>
              <Save />
              {isPending ? t("common.saving") : t("settings.general.invoices.save")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

const emptyLegalEntity = (): LegalEntityInput => ({
  legalName: "",
  address: "",
  registrationNumber: "",
  taxNumber: "",
  billingEmail: "",
  iban: "",
  bankName: "",
  bankCode: "",
  additionalInfo: "",
  isDefault: false,
});

function LegalEntitiesCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  const { data: entities = [], isLoading } = useLegalEntities(workspace.id);
  const createEntity = useCreateLegalEntity(workspace.id);
  const updateEntity = useUpdateLegalEntity(workspace.id);
  const deleteEntity = useDeleteLegalEntity(workspace.id);
  const [draft, setDraft] = useState<LegalEntityInput>(emptyLegalEntity());
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(entity: LegalEntity) {
    setEditingId(entity.id);
    setDraft({
      legalName: entity.legalName,
      address: entity.address,
      registrationNumber: entity.registrationNumber,
      taxNumber: entity.taxNumber,
      billingEmail: entity.billingEmail,
      iban: entity.iban,
      bankName: entity.bankName,
      bankCode: entity.bankCode,
      additionalInfo: entity.additionalInfo,
      isDefault: entity.isDefault,
    });
  }

  async function onSave() {
    if (!draft.legalName.trim()) {
      toast.error(t("settings.general.legalEntities.validation.nameRequired"));
      return;
    }
    if (editingId) {
      await updateEntity.mutateAsync({ entityId: editingId, input: draft });
    } else {
      await createEntity.mutateAsync(draft);
    }
    setEditingId(null);
    setDraft(emptyLegalEntity());
  }

  const busy = createEntity.isPending || updateEntity.isPending || deleteEntity.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.legalEntities.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.legalEntities.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">{t("settings.general.legalEntities.softDeleteNote")}</p>
        {isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}
        {!isLoading && entities.length === 0 ? (
          <EmptyState title={t("settings.general.legalEntities.emptyTitle")} description={t("settings.general.legalEntities.emptyDescription")} className="py-8" />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {entities.map((entity) => (
              <div key={entity.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entity.legalName}
                    {entity.isDefault ? <span className="ml-2 text-xs text-muted-foreground">({t("settings.general.legalEntities.defaultBadge")})</span> : null}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">{entity.taxNumber || entity.registrationNumber || entity.billingEmail || "—"}</p>
                </div>
                {canEdit ? (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(entity)} disabled={busy}>
                      {t("common.edit")}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void deleteEntity.mutateAsync(entity.id)} disabled={busy}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {canEdit ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">{editingId ? t("settings.general.legalEntities.editTitle") : t("settings.general.legalEntities.addTitle")}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="le-name">{t("settings.general.legalEntities.fields.legalName")}</Label>
                <Input id="le-name" value={draft.legalName} onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="le-address">{t("settings.general.legalEntities.fields.address")}</Label>
                <Input id="le-address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-reg">{t("settings.general.legalEntities.fields.registrationNumber")}</Label>
                <Input id="le-reg" value={draft.registrationNumber} onChange={(e) => setDraft({ ...draft, registrationNumber: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-tax">{t("settings.general.legalEntities.fields.taxNumber")}</Label>
                <Input id="le-tax" value={draft.taxNumber} onChange={(e) => setDraft({ ...draft, taxNumber: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-email">{t("settings.general.legalEntities.fields.billingEmail")}</Label>
                <Input id="le-email" type="email" value={draft.billingEmail} onChange={(e) => setDraft({ ...draft, billingEmail: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-iban">{t("settings.general.legalEntities.fields.iban")}</Label>
                <Input id="le-iban" value={draft.iban} onChange={(e) => setDraft({ ...draft, iban: e.target.value })} disabled={busy} className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-bank">{t("settings.general.legalEntities.fields.bankName")}</Label>
                <Input id="le-bank" value={draft.bankName} onChange={(e) => setDraft({ ...draft, bankName: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="le-bank-code">{t("settings.general.legalEntities.fields.bankCode")}</Label>
                <Input id="le-bank-code" value={draft.bankCode} onChange={(e) => setDraft({ ...draft, bankCode: e.target.value })} disabled={busy} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="le-extra">{t("settings.general.legalEntities.fields.additionalInfo")}</Label>
                <Textarea id="le-extra" rows={2} value={draft.additionalInfo} onChange={(e) => setDraft({ ...draft, additionalInfo: e.target.value })} disabled={busy} />
              </div>
            </div>
            <SettingRow
              label={t("settings.general.legalEntities.fields.isDefault")}
              control={<Switch checked={Boolean(draft.isDefault)} onCheckedChange={(checked) => setDraft({ ...draft, isDefault: checked })} disabled={busy} />}
            />
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setDraft(emptyLegalEntity());
                  }}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
              <Button type="button" onClick={() => void onSave()} disabled={busy}>
                <Save />
                {busy ? t("common.saving") : t("settings.general.legalEntities.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentsSettingsCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.payments.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.payments.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-5">
          <p className="text-sm font-medium text-foreground">{t("settings.general.payments.unavailableTitle")}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("settings.general.payments.unavailableDescription")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SecuritySettingsCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const canEdit = useCanEditWorkspaceSettings(workspace.role);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.general.security.title")}
        </CardTitle>
        <CardDescription>{t("settings.general.security.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{t("settings.general.security.rolesNote")}</p>
        <p>{canEdit ? t("settings.general.security.ownerNote") : t("settings.general.security.memberNote")}</p>
        <p>{t("settings.general.security.noIpNote")}</p>
        <p>{t("settings.general.security.deletionNote")}</p>
      </CardContent>
    </Card>
  );
}

export function GeneralSettingsExtra() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  if (!workspace) return null;

  return (
    <>
      <OrdersSettingsCard workspace={workspace} />
      <ContactsSettingsCard workspace={workspace} />
      <InvoicesSettingsCard workspace={workspace} />
      <LegalEntitiesCard workspace={workspace} />
      <PaymentsSettingsCard />
      <SecuritySettingsCard workspace={workspace} />
    </>
  );
}
