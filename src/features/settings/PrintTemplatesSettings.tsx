import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import {
  applyCommonStyleToAllTemplates,
  createTemplatesFromSource,
  DOCUMENT_STYLE_TYPE,
  ensureDefaultDocumentStyle,
  ensureDefaultInvoiceTemplate,
  isBuilderDocumentType,
  isDocumentStyleType,
} from "../../services/apiDocumentTemplates";
import { DocumentStyleEditor } from "../documents/DocumentStyleEditor";
import { DocumentTemplateBuilder } from "../documents/DocumentTemplateBuilder";
import type { DocumentTemplateType } from "../documents/layout";
import { useGetDocumentTemplates } from "../documents/useGetDocumentTemplates";
import {
  useCreateDocumentTemplate,
  useDeleteDocumentTemplate,
  useDuplicateDocumentTemplate,
  useRenameDocumentTemplate,
  useSetDefaultDocumentTemplate,
} from "../documents/useDocumentTemplateMutations";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useCanEditWorkspaceSettings, useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

const DOCUMENT_TYPES: DocumentTemplateType[] = ["work_order", "act", "invoice"];

/** Inserts `text` at the current selection; exported for unit tests / legacy HTML editor helpers. */
export function insertTextAtCursor(textarea: Pick<HTMLTextAreaElement, "selectionStart" | "selectionEnd" | "value">, text: string) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const caret = start + text.length;
  return { next, caret };
}

/**
 * Print templates (`document_templates`): visual layout builder for work_order / act / invoice,
 * shared Document style, plus list CRUD (create, duplicate, rename, soft-delete, set default).
 */
export function PrintTemplatesSettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  const { data = [], isLoading, error } = useGetDocumentTemplates();
  const canEdit = useCanEditWorkspaceSettings(useActiveWorkspaceRole());
  const create = useCreateDocumentTemplate();
  const duplicate = useDuplicateDocumentTemplate();
  const rename = useRenameDocumentTemplate();
  const remove = useDeleteDocumentTemplate();
  const setDefault = useSetDefaultDocumentTemplate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createType, setCreateType] = useState<DocumentTemplateType>("work_order");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const ensuredDefaults = useRef(false);

  useEffect(() => {
    if (!canEdit || !workspaceId || isLoading || ensuredDefaults.current) return;
    ensuredDefaults.current = true;
    void (async () => {
      try {
        await ensureDefaultDocumentStyle(workspaceId);
        const hasInvoice = data.some((template) => template.documentType === "invoice");
        if (!hasInvoice) await ensureDefaultInvoiceTemplate(workspaceId);
        void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
      } catch {
        ensuredDefaults.current = false;
      }
    })();
  }, [canEdit, workspaceId, isLoading, data, queryClient]);

  const styleTemplate = useMemo(
    () => data.find((template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isActive) ?? null,
    [data],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentTemplate[]>();
    for (const type of DOCUMENT_TYPES) map.set(type, []);
    for (const template of data) {
      if (isDocumentStyleType(template.documentType)) continue;
      const key = isBuilderDocumentType(template.documentType) ? template.documentType : template.documentType || "other";
      const list = map.get(key) ?? [];
      list.push(template);
      map.set(key, list);
    }
    return map;
  }, [data]);

  const editing = data.find((template) => template.id === editingId) ?? null;
  const editingStyle = editing?.documentType === DOCUMENT_STYLE_TYPE;

  function openEditor(template: DocumentTemplate) {
    if (editingId && editorDirty && !window.confirm(t("settings.printTemplates.unsavedConfirm"))) return;
    setEditingId(template.id);
    setEditorDirty(false);
  }

  function closeEditor() {
    setEditingId(null);
    setEditorDirty(false);
  }

  const createFrom = useMutation({
    mutationFn: (sourceId: string) => {
      guardWrite();
      const source = data.find((template) => template.id === sourceId);
      if (!source || !isBuilderDocumentType(source.documentType)) throw new Error(t("settings.printTemplates.errors.notSaved"));
      const targets = DOCUMENT_TYPES.filter((type) => type !== source.documentType);
      return createTemplatesFromSource(sourceId, workspaceId, targets);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
      toast.success(t("settings.printTemplates.toast.created"));
      if (result.unmappedTokens.length > 0) {
        toast.error(t("settings.printTemplates.unmappedTokens", { list: result.unmappedTokens.join(", ") }));
      }
    },
    onError: (err: Error) => toast.error(err.message || t("common.somethingWentWrong")),
  });

  const applyStyle = useMutation({
    mutationFn: () => {
      guardWrite();
      return applyCommonStyleToAllTemplates(workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
      toast.success(t("settings.printTemplates.toast.saved"));
    },
    onError: (err: Error) => toast.error(err.message || t("common.somethingWentWrong")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.printTemplates.title")}</CardTitle>
        <CardDescription>{t("settings.printTemplates.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.printTemplates.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        {styleTemplate ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{t("settings.printTemplates.documentStyle")}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              <li className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {styleTemplate.name}
                      {styleTemplate.isDefault ? (
                        <span className="ml-2 text-xs font-normal text-primary">
                          ({t("settings.printTemplates.defaultBadge")})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("settings.printTemplates.documentStyleHint")}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canEdit ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => openEditor(styleTemplate)}>
                          <Pencil />
                          {t("settings.printTemplates.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={applyStyle.isPending}
                          onClick={() => {
                            if (!window.confirm(t("settings.printTemplates.applyStyleToAllConfirm"))) return;
                            applyStyle.mutate();
                          }}
                        >
                          {t("settings.printTemplates.applyStyleToAll")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {editingStyle && editing?.id === styleTemplate.id ? (
                  <DocumentStyleEditor
                    template={styleTemplate}
                    canEdit={canEdit}
                    onClose={closeEditor}
                    onDirtyChange={setEditorDirty}
                  />
                ) : null}
              </li>
            </ul>
          </div>
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select value={createType} onValueChange={(value) => setCreateType(value as DocumentTemplateType)}>
              <SelectTrigger className="w-56" aria-label={t("settings.printTemplates.documentType")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`settings.printTemplates.documentTypes.${type}` as "settings.printTemplates.documentTypes.work_order")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              loading={create.isPending}
              disabled={create.isPending}
              onClick={() =>
                create.mutate(
                  { documentType: createType },
                  {
                    onSuccess: (created) => {
                      setEditingId(created.id);
                      setEditorDirty(false);
                    },
                  },
                )
              }
            >
              <Plus />
              {t("settings.printTemplates.create")}
            </Button>
          </div>
        ) : null}

        {!isLoading && !error && data.filter((template) => !isDocumentStyleType(template.documentType)).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.printTemplates.empty")}</p>
        ) : null}

        {[...DOCUMENT_TYPES, ...[...grouped.keys()].filter((key) => !isBuilderDocumentType(key))].map((type) => {
          const templates = grouped.get(type) ?? [];
          if (templates.length === 0 && !isBuilderDocumentType(type)) return null;
          if (templates.length === 0) return null;
          return (
            <div key={type} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                {isBuilderDocumentType(type)
                  ? t(`settings.printTemplates.documentTypes.${type}` as "settings.printTemplates.documentTypes.work_order")
                  : type}
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {templates.map((template) => (
                  <li key={template.id} className="space-y-3 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        {renamingId === template.id ? (
                          <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              rename.mutate(
                                { id: template.id, name: renameDraft },
                                {
                                  onSuccess: () => {
                                    setRenamingId(null);
                                    setRenameDraft("");
                                  },
                                },
                              );
                            }}
                          >
                            <Input
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              className="h-8 w-56"
                              aria-label={t("settings.printTemplates.name")}
                            />
                            <Button type="submit" size="sm" loading={rename.isPending}>
                              {t("common.save")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRenamingId(null);
                                setRenameDraft("");
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                          </form>
                        ) : (
                          <p className="text-sm font-medium text-foreground">
                            {template.name}
                            {template.isDefault ? (
                              <span className="ml-2 text-xs font-normal text-primary">
                                ({t("settings.printTemplates.defaultBadge")})
                              </span>
                            ) : null}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {template.layout ? t("settings.printTemplates.layoutTemplate") : t("settings.printTemplates.legacyHtml")}
                          {template.layout?.useStyle ? ` · ${t("settings.printTemplates.useCommonStyle")}` : ""}
                          {template.isActive ? "" : ` · ${t("settings.printTemplates.inactive")}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {canEdit ? (
                          <>
                            <Button type="button" variant="outline" size="sm" onClick={() => openEditor(template)}>
                              <Pencil />
                              {t("settings.printTemplates.edit")}
                            </Button>
                            {template.layout && isBuilderDocumentType(template.documentType) ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={createFrom.isPending}
                                onClick={() => createFrom.mutate(template.id)}
                              >
                                {t("settings.printTemplates.createFromTemplate")}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={duplicate.isPending}
                              onClick={() => duplicate.mutate(template.id)}
                            >
                              <Copy />
                              {t("settings.printTemplates.duplicate")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRenamingId(template.id);
                                setRenameDraft(template.name);
                              }}
                            >
                              {t("settings.printTemplates.rename")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={template.isDefault || setDefault.isPending}
                              onClick={() => setDefault.mutate(template.id)}
                            >
                              <Star />
                              {t("settings.printTemplates.setDefault")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={remove.isPending}
                              onClick={() => {
                                if (!window.confirm(t("settings.printTemplates.deleteConfirm"))) return;
                                if (editingId === template.id) closeEditor();
                                remove.mutate(template.id);
                              }}
                            >
                              <Trash2 />
                              {t("common.delete")}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {editing && !editingStyle && editing.id === template.id ? (
                      <DocumentTemplateBuilder
                        template={template}
                        canEdit={canEdit}
                        onClose={closeEditor}
                        onDirtyChange={setEditorDirty}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground">{t("settings.printTemplates.stubNote")}</p>
      </CardContent>
    </Card>
  );
}
