import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { useConfirm } from "../../ui/ConfirmProvider";
import { PERMISSION_KEYS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import type { OrderFieldConfigItem } from "../orders/orderFieldConfig";
import type { OrderFieldGroup, OrderFieldType } from "../orders/orderFieldRegistry";
import { BUILTIN_ORDER_FIELD_KEYS, orderFieldGroupLabel, slugifyOrderFieldKey } from "../orders/orderFieldRegistry";

/** Avoid collisions with built-in keys, active and archived custom fields (unique index on field_key). */
function uniqueCustomFieldKey(base: string, taken: string[]): string {
  const used = new Set([...taken, ...BUILTIN_ORDER_FIELD_KEYS]);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}
import {
  useCreateCustomOrderField,
  useOrderFieldConfig,
  useResetAllSystemOrderFieldOverrides,
  useResetSystemOrderFieldOverride,
  useSoftDeleteCustomOrderField,
  useUpdateCustomOrderField,
  useUpsertSystemOrderFieldOverride,
} from "../orders/useOrderFieldConfig";
import { useIndustryProfile } from "../industries/useIndustryProfile";
import { Skeleton } from "../../ui/Skeleton";

const GROUP_ORDER: OrderFieldGroup[] = ["clientOrder", "asset", "work", "custom"];

const CUSTOM_TYPES: OrderFieldType[] = ["text", "textarea", "number", "date", "datetime", "select", "checkbox"];

function OrderFieldPreview({ fields }: { fields: OrderFieldConfigItem[] }) {
  const { t } = useTranslation();
  const visible = fields.filter((f) => f.visible);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
        {t("settings.orderFields.previewTitle")}
      </p>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.orderFields.previewEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((field) => (
            <li key={field.key} className="rounded-md border border-border bg-card px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {field.isCustom
                  ? t(`settings.orderFields.types.${field.type}`, { defaultValue: field.type })
                  : t("settings.orderFields.builtinBadge")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrderFieldsSettings() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  const canEdit = withSubscriptionWriteAccess(
    can(PERMISSION_KEYS.settingsForms, canManageWorkspace(workspaceRole)),
    subscriptionAllowsWrite,
  );

  const { fields, archivedCustomFields, isLoading, isError, error, refetch } = useOrderFieldConfig();
  const { profile } = useIndustryProfile();
  const upsertSystem = useUpsertSystemOrderFieldOverride();
  const updateCustom = useUpdateCustomOrderField();
  const createCustom = useCreateCustomOrderField();
  const softDelete = useSoftDeleteCustomOrderField();
  const resetOne = useResetSystemOrderFieldOverride();
  const resetAll = useResetAllSystemOrderFieldOverrides();

  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<OrderFieldType>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newOptionsText, setNewOptionsText] = useState("");
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});

  const sorted = useMemo(() => [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)), [fields]);
  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      title: orderFieldGroupLabel(group, profile),
      fields: sorted.filter((field) => field.group === group),
    })).filter((section) => section.fields.length > 0);
  }, [sorted, profile]);

  function labelFor(field: OrderFieldConfigItem) {
    return draftLabels[field.key] ?? field.label;
  }

  async function persistField(field: OrderFieldConfigItem, patch: Partial<Pick<OrderFieldConfigItem, "label" | "visible" | "required" | "sortOrder">>) {
    if (!canEdit) return;
    const next = { ...field, ...patch };
    if (field.isCustom && field.definitionId) {
      await updateCustom.mutateAsync({
        definitionId: field.definitionId,
        label: next.label,
        isActive: next.visible,
        isRequired: next.required,
        sortOrder: next.sortOrder,
      });
      return;
    }
    // Store a label override only when the user actually renamed the field.
    // Saving the default label would freeze it (language / industry changes).
    const renamed = next.label.trim() !== "" && next.label.trim() !== (field.defaultLabel ?? "").trim();
    await upsertSystem.mutateAsync({
      fieldKey: field.key,
      label: renamed ? next.label.trim() : "",
      isActive: next.visible,
      isRequired: next.required,
      sortOrder: next.sortOrder,
      fieldType: field.type === "builtin" ? "text" : field.type,
    });
  }

  async function moveField(field: OrderFieldConfigItem, direction: -1 | 1) {
    const index = sorted.findIndex((row) => row.key === field.key);
    const swapWith = sorted[index + direction];
    if (!swapWith || index < 0) return;
    await persistField(field, { sortOrder: swapWith.sortOrder });
    await persistField(swapWith, { sortOrder: field.sortOrder });
  }

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    const options =
      newType === "select"
        ? newOptionsText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [value, ...rest] = line.split("|");
              return { value: (value ?? "").trim(), label: (rest.join("|").trim() || value || "").trim() };
            })
            .filter((opt) => opt.value)
        : [];
    const maxSort = sorted.reduce((max, row) => Math.max(max, row.sortOrder), 400);
    await createCustom.mutateAsync({
      fieldKey: uniqueCustomFieldKey(slugifyOrderFieldKey(label), [...fields, ...archivedCustomFields].map((row) => row.key)),
      label,
      fieldType: newType,
      options,
      isRequired: newRequired,
      sortOrder: maxSort + 10,
    });
    setAddOpen(false);
    setNewLabel("");
    setNewType("text");
    setNewRequired(false);
    setNewOptionsText("");
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.orderFields.title")}</CardTitle>
          <CardDescription>{(error as Error)?.message || t("settings.orderFields.errors.loadFailed")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{t("settings.orderFields.title")}</CardTitle>
            <CardDescription>{t("settings.orderFields.description")}</CardDescription>
            {!canEdit ? <p className="text-xs text-muted-foreground">{t("settings.orderFields.readOnlyHint")}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                  {t("settings.orderFields.addField")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={resetAll.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("settings.orderFields.resetAllTitle"),
                      description: t("settings.orderFields.resetAllDescription"),
                      confirmLabel: t("settings.orderFields.resetAll"),
                    });
                    if (ok) await resetAll.mutateAsync();
                  }}
                >
                  <RotateCcw className="size-4" />
                  {t("settings.orderFields.resetAll")}
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {grouped.map((section) => (
            <div key={section.group} className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{section.title}</h3>
              {section.fields.map((field) => {
                const index = sorted.findIndex((row) => row.key === field.key);
                const displayLabel = labelFor(field);
                return (
                  <div
                    key={field.key}
                    className="space-y-3 rounded-lg border border-border p-3"
                    draggable={canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", field.key);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={async (event) => {
                      event.preventDefault();
                      if (!canEdit) return;
                      const fromKey = event.dataTransfer.getData("text/plain");
                      const from = sorted.find((row) => row.key === fromKey);
                      if (!from || from.key === field.key) return;
                      await persistField(from, { sortOrder: field.sortOrder });
                      await persistField(field, { sortOrder: from.sortOrder });
                    }}
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`order-field-label-${field.key}`}>{t("settings.orderFields.label")}</Label>
                        <Input
                          id={`order-field-label-${field.key}`}
                          value={displayLabel}
                          disabled={!canEdit || !field.canRename}
                          onChange={(event) => {
                            setDraftLabels((prev) => ({ ...prev, [field.key]: event.target.value }));
                          }}
                          onBlur={(event) => {
                            const next = event.target.value.trim();
                            if (!next || next === field.label) {
                              setDraftLabels((prev) => {
                                const copy = { ...prev };
                                delete copy[field.key];
                                return copy;
                              });
                              return;
                            }
                            void persistField(field, { label: next }).then(() => {
                              setDraftLabels((prev) => {
                                const copy = { ...prev };
                                delete copy[field.key];
                                return copy;
                              });
                            });
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          {field.isCustom ? t("settings.orderFields.customBadge") : t("settings.orderFields.builtinBadge")}
                          {!field.isCustom && field.defaultLabel && field.label.trim() !== field.defaultLabel.trim()
                            ? ` · ${t("settings.orderFields.defaultNameHint", { label: field.defaultLabel })}`
                            : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={!canEdit || index <= 0}
                          aria-label={t("settings.orderFields.moveUp")}
                          onClick={() => void moveField(field, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={!canEdit || index < 0 || index >= sorted.length - 1}
                          aria-label={t("settings.orderFields.moveDown")}
                          onClick={() => void moveField(field, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={field.visible}
                          disabled={!canEdit || !field.canHide}
                          aria-label={t("settings.orderFields.visibleAria", { label: displayLabel })}
                          onCheckedChange={(checked) => void persistField(field, { visible: checked })}
                        />
                        {t("settings.orderFields.visible")}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={field.required}
                          disabled={!canEdit || !field.canRequire}
                          aria-label={t("settings.orderFields.requiredAria", { label: displayLabel })}
                          onCheckedChange={(checked) => void persistField(field, { required: checked })}
                        />
                        {t("settings.orderFields.required")}
                      </label>
                      {canEdit && !field.isCustom ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void resetOne.mutateAsync(field.key)}
                        >
                          <RotateCcw className="size-3.5" />
                          {t("settings.orderFields.resetOne")}
                        </Button>
                      ) : null}
                      {canEdit && field.isCustom && field.definitionId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("settings.orderFields.deleteTitle"),
                              description: t("settings.orderFields.deleteDescription"),
                              confirmLabel: t("common.delete"),
                              tone: "destructive",
                            });
                            if (ok) await softDelete.mutateAsync(field.definitionId!);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          {t("common.delete")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {archivedCustomFields.length > 0 ? (
            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="text-sm font-medium text-foreground">{t("settings.orderFields.archivedTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("settings.orderFields.archivedHint")}</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {archivedCustomFields.map((field) => (
                  <li key={field.key}>
                    {field.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <OrderFieldPreview fields={sorted} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.orderFields.addTitle")}</DialogTitle>
            <DialogDescription>{t("settings.orderFields.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-order-field-label">{t("settings.orderFields.label")}</Label>
              <Input id="new-order-field-label" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.orderFields.type")}</Label>
              <Select value={newType} onValueChange={(value) => setNewType(value as OrderFieldType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`settings.orderFields.types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newType === "select" ? (
              <div className="space-y-1.5">
                <Label htmlFor="new-order-field-options">{t("settings.orderFields.optionsHint")}</Label>
                <textarea
                  id="new-order-field-options"
                  className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={newOptionsText}
                  onChange={(event) => setNewOptionsText(event.target.value)}
                  placeholder={t("settings.orderFields.optionsPlaceholder")}
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={newRequired} onCheckedChange={setNewRequired} />
              {t("settings.orderFields.required")}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={!newLabel.trim() || createCustom.isPending} onClick={() => void handleAdd()}>
              {t("settings.orderFields.addField")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
