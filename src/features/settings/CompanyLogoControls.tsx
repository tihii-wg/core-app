import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { WorkspaceAvatar } from "../../ui/WorkspaceAvatar";
import { useRemoveWorkspaceAvatar, useUploadWorkspaceAvatar, useWorkspaceAvatar } from "../workspaces/useWorkspaceAvatar";

import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { CompanyLogoCropDialog } from "./CompanyLogoCropDialog";
import { workspaceLogoFileError } from "../workspaces/workspaceAvatar";

export function CompanyLogoControls({ workspace }: { workspace: WorkspaceDetails }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { data: imageUrl, isError } = useWorkspaceAvatar(workspace.id, workspace.avatarPath);
  const { mutateAsync: uploadLogo, isPending: uploading } = useUploadWorkspaceAvatar();
  const { mutateAsync: removeLogo, isPending: removing } = useRemoveWorkspaceAvatar();
  const busy = uploading || removing;

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
      <Label>Company logo</Label>
      <WorkspaceAvatar name={workspace.name || "Company"} imageUrl={imageUrl} size="lg" />
      {isError && <p className="text-sm text-[#f41f20]">Unable to load company logo. Please try again.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={chooseFile} disabled={busy}>
          {uploading ? "Uploading..." : workspace.avatarPath ? "Change logo" : "Upload logo"}
        </Button>
        {workspace.avatarPath && (
          <Button type="button" variant="outline" onClick={() => setRemoveOpen(true)} disabled={busy}>
            {removing ? "Removing..." : "Remove logo"}
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        aria-label="Company logo"
        onChange={(event) => onFile(event.target.files)}
      />
      <CompanyLogoCropDialog imageUrl={previewUrl} open={cropOpen} saving={uploading} onOpenChange={(open) => (open ? setCropOpen(true) : closeCrop())} onConfirm={saveLogo} />
      <Dialog open={removeOpen} onOpenChange={(open) => !removing && setRemoveOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove company logo?</DialogTitle>
            <DialogDescription>The workspace will use its initials instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)} disabled={removing}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove().catch(() => undefined)} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
