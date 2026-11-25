import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { PERMISSION_KEYS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import {
  FORM_ENTITIES,
  resolveFormFields,
  type FormEntity,
  type FormFieldOverrides,
  type ResolvedFormField,
} from "../formFields/formFieldRegistry";
import { useFormFieldOverrides, useSaveFormFieldOverrides } from "../formFields/useFormFields";

/** Settings → «Поля форм»: rename, hide and reorder the fields of the client, service and product forms. */
export function FormFieldsSettings() {
  const { t } = useTranslation();
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  const canEdit = withSubscriptionWriteAccess(
    // module_settings writes need settings.general (RLS); forms settings are the same people in practice.
    can(PERMISSION_KEYS.settingsForms, canManageWorkspace(workspaceRole)) &&
      can(PERMISSION_KEYS.settingsGeneral, canManageWorkspace(workspaceRole)),
    subscriptionAllowsWrite,
  );
  const { data, isLoading, isError, error, refetch } = useFormFieldOverrides();
  const save = useSaveFormFieldOverrides();
  const [entity, setEntity] = useState<FormEntity>("client");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);

  const overrides: FormFieldOverrides = data?.[entity] ?? {};
  const fields = resolveFormFields(entity, overrides);
  const defaultLabel = (field: ResolvedFormField) =>
    t(`settings.formFields.labels.${entity}.${field.key}` as "settings.formFields.title", { defaultValue: field.key });

  function persist(next: FormFieldOverrides) {
    if (!canEdit) return;
    save.mutate({ entity, overrides: next });
  }

  function patchField(key: string, patch: { label?: string | null; hidden?: boolean }) {
    const current = { ...(overrides[key] ?? {}) };
    if (patch.label !== undefined) {
      if (patch.label) current.label = patch.label;
      else delete current.label;
    }
    if (patch.hidden !== undefined) {
      if (patch.hidden) current.hidden = true;
      else delete current.hidden;
    }
    const next = { ...overrides, [key]: current };
    if (Object.keys(current).length === 0) delete next[key];
    persist(next);
  }

  /** Any move rewrites the whole order of this form (one upsert). */
  function moveField(key: string, toIndex: number) {
    const keys = fields.map((field) => field.key);
    const from = keys.indexOf(key);
    const target = Math.max(0, Math.min(keys.length - 1, toIndex));
    if (from < 0 || from === target) return;
    keys.splice(from, 1);
    keys.splice(target, 0, key);
    const next: FormFieldOverrides = {};
    keys.forEach((fieldKey, index) => {
      next[fieldKey] = { ...(overrides[fieldKey] ?? {}), order: (index + 1) * 10 };
    });
    persist(next);
  }

  function resetField(key: string) {
    const next = { ...overrides };
    const order = next[key]?.order;
    if (order != null) next[key] = { order };
    else delete next[key];
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[`${entity}.${key}`];
      return copy;
    });
    persist(next);
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
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
          <CardTitle>{t("settings.formFields.title")}</CardTitle>
          <CardDescription>{(error as Error)?.message}</CardDescription>
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
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1.5">
          <CardTitle>{t("settings.formFields.title")}</CardTitle>
          <CardDescription>{t("settings.formFields.description")}</CardDescription>
          {!canEdit ? <p className="text-xs text-muted-foreground">{t("settings.formFields.readOnlyHint")}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {FORM_ENTITIES.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={entity === candidate}
              size="sm"
              variant={entity === candidate ? "default" : "outline"}
              onClick={() => setEntity(candidate)}
            >
              {t(`settings.formFields.entities.${candidate}`)}
            </Button>
          ))}
          {canEdit && Object.keys(overrides).length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDrafts({});
                persist({});
              }}
            >
              <RotateCcw className="size-3.5" />
              {t("settings.formFields.resetForm")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.map((field, index) => {
          const draftKey = `${entity}.${field.key}`;
          const fallback = defaultLabel(field);
          const value = drafts[draftKey] ?? field.customLabel ?? "";
          return (
            <div
              key={field.key}
              data-form-field={field.key}
              className={cn(
                "space-y-2 rounded-lg border border-border bg-card p-3",
                dragKey === field.key && "opacity-60",
              )}
              draggable={canEdit}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", field.key);
                event.dataTransfer.effectAllowed = "move";
                setDragKey(field.key);
              }}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(event) => {
                if (canEdit) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const fromKey = event.dataTransfer.getData("text/plain");
                setDragKey(null);
                if (fromKey && fromKey !== field.key) moveField(fromKey, index);
              }}
            >
              <div className="flex items-start gap-2">
                {canEdit ? <GripVertical className="mt-7 size-4 shrink-0 cursor-grab text-subtle-foreground" aria-hidden /> : null}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`form-field-${draftKey}`}>{t("settings.formFields.label")}</Label>
                  <Input
                    id={`form-field-${draftKey}`}
                    value={field.canRename ? value : fallback}
                    placeholder={fallback}
                    disabled={!canEdit || !field.canRename}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [draftKey]: event.target.value }))}
                    onBlur={() => {
                      const draft = drafts[draftKey];
                      if (draft === undefined) return;
                      const next = draft.trim();
                      setDrafts((prev) => {
                        const copy = { ...prev };
                        delete copy[draftKey];
                        return copy;
                      });
                      // Typing the default name back means «no rename».
                      const label = next && next !== fallback ? next : null;
                      if ((label ?? null) !== (field.customLabel ?? null)) patchField(field.key, { label });
                    }}
                  />
                  {field.customLabel ? (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.formFields.defaultNameHint", { label: fallback })}
                    </p>
                  ) : null}
                  {field.lock ? (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                      {field.lock === "logic" ? t("settings.formFields.logicHint") : t("settings.formFields.systemHint")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={!canEdit || index === 0}
                    aria-label={t("settings.orderFields.moveUp")}
                    onClick={() => moveField(field.key, index - 1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={!canEdit || index === fields.length - 1}
                    aria-label={t("settings.orderFields.moveDown")}
                    onClick={() => moveField(field.key, index + 1)}
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
                    aria-label={t("settings.orderFields.visibleAria", { label: field.customLabel ?? fallback })}
                    onCheckedChange={(checked) => patchField(field.key, { hidden: !checked })}
                  />
                  {t("settings.orderFields.visible")}
                </label>
                {canEdit && (field.customLabel || !field.visible) ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => resetField(field.key)}>
                    <RotateCcw className="size-3.5" />
                    {t("settings.orderFields.resetOne")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
