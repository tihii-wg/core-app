import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { WorkspaceAvatar } from "../../ui/WorkspaceAvatar";
import { useRemoveWorkspaceAvatar, useUploadWorkspaceAvatar, useWorkspaceAvatar } from "../workspaces/useWorkspaceAvatar";

import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { CompanyLogoCropDialog } from "./CompanyLogoCropDialog";
import { workspaceLogoFileError } from "../workspaces/workspaceAvatar";
import { canManageWorkspace } from "../workspaces/workspaceRoles";

export function CompanyLogoControls({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { data: imageUrl, isError } = useWorkspaceAvatar(workspace.id, workspace.avatarPath);
  const { mutateAsync: uploadLogo, isPending: uploading } = useUploadWorkspaceAvatar();
  const { mutateAsync: removeLogo, isPending: removing } = useRemoveWorkspaceAvatar();
  const busy = uploading || removing;
  const canEdit = canManageWorkspace(workspace.role);

  function chooseFile() {
    inputRef.current?.click();
  }

  function onFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    const message = workspaceLogoFileError(file);
    if (message) {
      toast.error(message);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
    setCropOpen(true);
  }

  function closeCrop() {
    setCropOpen(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  async function saveLogo(file: Blob) {
    await uploadLogo({ workspaceId: workspace.id, file });
    closeCrop();
  }

  async function confirmRemove() {
    await removeLogo({ workspaceId: workspace.id, avatarPath: workspace.avatarPath });
    setRemoveOpen(false);
  }

  return (
    <div className="space-y-3">
      <Label>{t("settings.logo.label")}</Label>
      <WorkspaceAvatar name={workspace.name || t("settings.logo.fallbackName")} imageUrl={imageUrl} size="lg" />
      {isError && <p className="text-sm text-destructive">{t("settings.logo.loadFailed")}</p>}
      {canEdit && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={chooseFile} disabled={busy}>
          {uploading ? t("settings.logo.uploading") : workspace.avatarPath ? t("settings.logo.change") : t("settings.logo.upload")}
        </Button>
        {workspace.avatarPath && (
          <Button type="button" variant="outline" onClick={() => setRemoveOpen(true)} disabled={busy}>
            {removing ? t("settings.logo.removing") : t("settings.logo.remove")}
          </Button>
        )}
      </div>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        aria-label={t("settings.logo.label")}
        onChange={(event) => onFile(event.target.files)}
      />
      <CompanyLogoCropDialog imageUrl={previewUrl} open={cropOpen} saving={uploading} onOpenChange={(open) => (open ? setCropOpen(true) : closeCrop())} onConfirm={saveLogo} />
      <Dialog open={removeOpen} onOpenChange={(open) => !removing && setRemoveOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.logo.removeDialog.title")}</DialogTitle>
            <DialogDescription>{t("settings.logo.removeDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)} disabled={removing}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove().catch(() => undefined)} disabled={removing}>
              {removing ? t("settings.logo.removing") : t("settings.logo.removeDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
