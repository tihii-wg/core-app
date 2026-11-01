import { useState } from "react";
import { Pencil, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { buildPrintDocument } from "../documents/printTemplate";
import { useGetDocumentTemplates } from "../documents/useGetDocumentTemplates";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { MAX_TEMPLATE_BODY_LENGTH } from "../../services/apiDocumentTemplates";
import { useUpdateDocumentTemplateBody } from "../documents/useUpdateDocumentTemplate";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";

/**
 * Print templates (`document_templates`): preview plus a simple `body_html` textarea editor.
 * HTML is stored as typed and always sanitised when previewed or printed (`buildPrintDocument`).
 */
export function PrintTemplatesSettings() {
  const { t } = useTranslation();
  const { data = [], isLoading, error } = useGetDocumentTemplates();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const canEdit = useCanEditWorkspaceSettings(useActiveWorkspaceRole());
  const save = useUpdateDocumentTemplateBody();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.printTemplates.title")}</CardTitle>
        <CardDescription>{t("settings.printTemplates.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.printTemplates.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.printTemplates.empty")}</p>
        ) : null}
        {data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((template) => (
              <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {template.documentType}
                    {template.widthMm && template.heightMm ? ` · ${template.widthMm} × ${template.heightMm} mm` : ""}
                    {template.isAvailableToAll ? "" : ` · ${t("settings.printTemplates.restricted")}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && editingId !== template.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => {
                        setEditingId(template.id);
                        setDraft(template.bodyHtml);
                        setPreviewId(null);
                      }}
                    >
                      <Pencil />
                      {t("settings.printTemplates.edit")}
                    </Button>
                  ) : null}
                  {template.bodyHtml.trim() ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewId(previewId === template.id ? null : template.id)}
                    >
                      {previewId === template.id ? t("settings.printTemplates.hidePreview") : t("settings.printTemplates.preview")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("settings.printTemplates.noBody")}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {template.isActive ? t("settings.printTemplates.active") : t("settings.printTemplates.inactive")}
                  </span>
                </div>
                {editingId === template.id ? (
                  <div className="basis-full space-y-2">
                    <Label htmlFor={`template-body-${template.id}`}>{t("settings.printTemplates.bodyLabel")}</Label>
                    <Textarea
                      id={`template-body-${template.id}`}
                      className="min-h-48 font-mono text-xs"
                      spellCheck={false}
                      maxLength={MAX_TEMPLATE_BODY_LENGTH}
                      value={draft}
                      disabled={save.isPending}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("settings.printTemplates.editorHint")}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        loading={save.isPending}
                        disabled={save.isPending || draft === template.bodyHtml}
                        onClick={() => save.mutate({ id: template.id, bodyHtml: draft }, { onSuccess: () => setEditingId(null) })}
                      >
                        <Save />
                        {t("settings.printTemplates.save")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => setEditingId(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                    {draft.trim() ? (
                      <iframe
                        title={t("settings.printTemplates.previewTitle", { name: template.name })}
                        // Empty sandbox: no scripts, forms or same-origin access; HTML is also sanitised.
                        sandbox=""
                        srcDoc={buildPrintDocument(draft, template.name)}
                        className="h-56 w-full rounded-md border border-border bg-white"
                      />
                    ) : null}
                  </div>
                ) : null}
                {previewId === template.id ? (
                  <iframe
                    title={t("settings.printTemplates.previewTitle", { name: template.name })}
                    // Empty sandbox: no scripts, forms or same-origin access; HTML is also sanitised.
                    sandbox=""
                    srcDoc={buildPrintDocument(template.bodyHtml, template.name)}
                    className="mt-2 h-72 w-full basis-full rounded-md border border-border bg-white"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.printTemplates.stubNote")}</p>
      </CardContent>
    </Card>
  );
}
