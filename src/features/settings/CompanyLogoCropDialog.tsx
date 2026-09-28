import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { cropImageToWebp, LOGO_UPLOAD_ERROR } from "../workspaces/workspaceAvatar";


export function CompanyLogoCropDialog({
  imageUrl,
  open,
  saving,
  onOpenChange,
  onConfirm,
}: {
  imageUrl: string | null;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (file: Blob) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Crop company logo</DialogTitle>
          <DialogDescription>Move and zoom the image, then save a square logo.</DialogDescription>
        </DialogHeader>
        {imageUrl ? <LogoCropper key={imageUrl} imageUrl={imageUrl} saving={saving} onConfirm={onConfirm} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LogoCropper({ imageUrl, saving, onConfirm, onCancel }: { imageUrl: string; saving: boolean; onConfirm: (file: Blob) => Promise<void>; onCancel: () => void }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [converting, setConverting] = useState(false);

  async function save() {
    if (!pixels) return;
    setConverting(true);
    let file: Blob;
    try {
      file = await cropImageToWebp(imageUrl, pixels);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : LOGO_UPLOAD_ERROR);
      setConverting(false);
      return;
    }

    setConverting(false);
    try {
      await onConfirm(file);
    } catch {
      return;
    }
  }

  const busy = saving || converting;

  return (
    <>
      <div className="relative h-80 overflow-hidden rounded-md bg-[#eeeeef]">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={0}
          aspect={1}
          cropShape="rect"
          showGrid={false}
          style={{}}
          classes={{}}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_area, nextPixels) => setPixels(nextPixels)}
        />
      </div>
      <label className="flex items-center gap-3 text-sm text-muted-foreground">
        Zoom
        <input aria-label="Zoom" type="range" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={(event) => setZoom(Number(event.target.value))} className="w-full" />
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy || !pixels}>
          {busy ? "Uploading..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
