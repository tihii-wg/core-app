import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImageOff, Trash2, X } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/Dialog";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { useFullPhotoUrl, useInventoryThumbUrls, useRemoveInventoryPhoto, useUploadInventoryPhoto } from "./useInventoryPhotos";

/** Full-size photo over the page; closes on the button, Esc or a tap outside the image. */
export function InventoryPhotoViewer({ photoPath, name, open, onOpenChange }: { photoPath: string | null | undefined; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { data: url, isLoading, isError } = useFullPhotoUrl(photoPath, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[100dvh] w-full max-w-[100vw] items-center justify-center border-0 bg-transparent p-2 shadow-none sm:max-w-[min(92vw,1100px)]"
        onClick={() => onOpenChange(false)}
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">{t("inventory.photo.viewerDescription")}</DialogDescription>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => onOpenChange(false)}
          className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
        >
          <X className="size-5" />
        </button>
        {isLoading ? (
          <Skeleton className="aspect-square w-[min(80vw,480px)]" />
        ) : isError || !url ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-card p-6 text-sm text-muted-foreground">
            <ImageOff className="size-6" />
            {t("inventory.photo.loadFailed")}
          </div>
        ) : (
          <img
            src={url}
            alt={name}
            className="max-h-[calc(100dvh-1rem)] max-w-full rounded-lg object-contain shadow-lg"
            onClick={(event) => event.stopPropagation()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Small square thumbnail; a tap opens the full photo. Nothing is rendered for an item without a photo. */
export function InventoryPhotoThumb({ photoPath, thumbUrl, name, className }: { photoPath: string | null | undefined; thumbUrl: string | null; name: string; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!photoPath) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("inventory.photo.open", { name })}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition-shadow hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
          className,
        )}
      >
        {thumbUrl ? <img src={thumbUrl} alt="" loading="lazy" className="size-full object-cover" /> : <Skeleton className="size-full rounded-none" />}
      </button>
      {open ? (
        // React events bubble out of portals to the row / card below; the wrapper keeps clicks in the viewer
        // from also opening the item.
        <span className="contents" onClick={(event) => event.stopPropagation()}>
          <InventoryPhotoViewer photoPath={photoPath} name={name} open={open} onOpenChange={setOpen} />
        </span>
      ) : null}
    </>
  );
}

/** Preview of a picked (not yet uploaded) file. */
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return undefined;
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lifecycle is tied to the file
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [file]);
  return url;
}

type PhotoFieldProps =
  | { mode: "existing"; itemId: string; photoPath: string | null | undefined; name: string }
  | { mode: "pending"; file: File | null; onFileChange: (file: File | null) => void };

/**
 * Photo block of the item forms. Edit: the photo is uploaded / removed right away. Create: the picked file is
 * kept and uploaded after the item is saved (`mode: "pending"`). On a phone the picker offers the camera.
 */
export function InventoryPhotoField(props: PhotoFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadInventoryPhoto();
  const remove = useRemoveInventoryPhoto();
  const existingPath = props.mode === "existing" ? props.photoPath : null;
  const thumbUrl = useInventoryThumbUrls(existingPath ? [existingPath] : [])(existingPath);
  const pendingUrl = useObjectUrl(props.mode === "pending" ? props.file : null);
  const busy = upload.isPending || remove.isPending;
  const hasPhoto = props.mode === "existing" ? Boolean(existingPath) : Boolean(props.file);
  const previewUrl = props.mode === "existing" ? thumbUrl : pendingUrl;

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (props.mode === "pending") props.onFileChange(file);
    else upload.mutate({ itemId: props.itemId, file, previousPath: existingPath });
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {hasPhoto ? (
          previewUrl ? (
            <img src={previewUrl} alt="" className="size-full object-cover" />
          ) : (
            <Skeleton className="size-full rounded-none" />
          )
        ) : (
          <Camera className="size-5 text-subtle-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium text-foreground">{t("inventory.photo.label")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Camera />
            {hasPhoto ? t("inventory.photo.replace") : t("inventory.photo.add")}
          </Button>
          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              className="hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (props.mode === "pending") props.onFileChange(null);
                else if (existingPath) remove.mutate({ itemId: props.itemId, photoPath: existingPath });
              }}
            >
              <Trash2 />
              {t("inventory.photo.remove")}
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
