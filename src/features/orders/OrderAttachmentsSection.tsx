import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Download, Eye, ExternalLink, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Skeleton } from "../../ui/Skeleton";
import { currentIntlLocale } from "../../i18n";
import {
  formatAttachmentBytes,
  isDriveAttachment,
  isNasAttachment,
  isImageMimeType,
  ORDER_ATTACHMENT_ACCEPT,
  validateOrderAttachmentFile,
  type OrderAttachment,
} from "./orderAttachments";
import { resolveOrderAttachmentUrl } from "../../services/apiOrderAttachments";
import {
  useCanMutateOrderAttachments,
  useDeleteOrderAttachment,
  useOrderAttachmentUrl,
  useOrderAttachments,
  useUploadOrderAttachment,
} from "./useOrderAttachments";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import toast from "react-hot-toast";

type OrderAttachmentsSectionProps = {
  orderId: string;
  /** When false, the panel is closed — skip fetching. */
  enabled?: boolean;
  /** When false, forces read-only (e.g. closed order without owner-manage). `undefined` keeps role default. */
  canMutateOverride?: boolean;
};

function formatUploadedAt(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "—";
  return date.toLocaleString(currentIntlLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function GoogleDriveGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M8.5 3.5 3 13h5.2l5.5-9.5z" />
      <path fill="#34A853" d="m15.5 3.5-5.5 9.5H21z" />
      <path fill="#FBBC04" d="M3 13.5 8.5 23h11L14 13.5z" />
    </svg>
  );
}

function NasGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="8" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <circle cx="7" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ProviderBadge({ attachment }: { attachment: OrderAttachment }) {
  const { t } = useTranslation();
  if (isDriveAttachment(attachment)) {
    return (
      <span className="ml-1.5 inline-flex align-middle text-muted-foreground" title={t("orders.attachments.storedOnDrive")}>
        <GoogleDriveGlyph className="size-3.5" />
      </span>
    );
  }
  if (isNasAttachment(attachment)) {
    return (
      <span className="ml-1.5 inline-flex align-middle text-muted-foreground" title={t("orders.attachments.storedOnNas")}>
        <NasGlyph className="size-3.5" />
      </span>
    );
  }
  return null;
}

function AttachmentThumb({ attachment, onOpen }: { attachment: OrderAttachment; onOpen: () => void }) {
  const { t } = useTranslation();
  const isImage = isImageMimeType(attachment.mimeType);
  const drive = isDriveAttachment(attachment);
  const nas = isNasAttachment(attachment);
  const { data: url, isLoading, isError } = useOrderAttachmentUrl(attachment, {
    enabled: isImage,
    variant: "thumb",
  });

  if (!isImage) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted"
        aria-label={t("orders.attachments.open", { name: attachment.fileName })}
      >
        <FileText className="size-6" aria-hidden />
        {drive ? <GoogleDriveGlyph className="absolute bottom-0.5 right-0.5 size-3.5 drop-shadow-sm" /> : null}
        {nas ? <NasGlyph className="absolute bottom-0.5 right-0.5 size-3.5 drop-shadow-sm" /> : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40 transition-opacity hover:opacity-90"
      aria-label={t("orders.attachments.preview", { name: attachment.fileName })}
    >
      {isLoading ? <Skeleton className="size-full" /> : null}
      {url && !isError ? (
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : !isLoading ? (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <ImageIcon className="size-6" aria-hidden />
        </span>
      ) : null}
      {drive ? <GoogleDriveGlyph className="absolute bottom-0.5 right-0.5 size-3.5 drop-shadow-sm" /> : null}
      {nas ? <NasGlyph className="absolute bottom-0.5 right-0.5 size-3.5 text-foreground drop-shadow-sm" /> : null}
    </button>
  );
}

function AttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: {
  attachment: OrderAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: url, isLoading, isError, refetch } = useOrderAttachmentUrl(attachment, {
    enabled: open && Boolean(attachment),
    variant: "full",
  });
  const isImage = attachment ? isImageMimeType(attachment.mimeType) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-8">{attachment?.fileName ?? t("orders.attachments.previewTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("orders.attachments.previewDescription")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {isLoading ? <Skeleton className="h-48 w-full" /> : null}
          {isError ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-destructive">{t("orders.attachments.errors.signedUrlFailed")}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {url && !isError && isImage ? (
            <img src={url} alt={attachment?.fileName ?? ""} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" />
          ) : null}
          {url && !isError && !isImage ? (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-8 text-center">
              <FileText className="mx-auto size-10 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium [overflow-wrap:anywhere] text-foreground">{attachment?.fileName}</p>
              <Button type="button" variant="outline" className="mt-4" asChild>
                <a href={url} target="_blank" rel="noreferrer" download={attachment?.fileName}>
                  <Download className="size-4" />
                  {t("orders.attachments.download")}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function OrderAttachmentsSection({
  orderId,
  enabled = true,
  canMutateOverride,
}: OrderAttachmentsSectionProps) {
  const { t } = useTranslation();
  const canMutateRole = useCanMutateOrderAttachments();
  const canMutate = canMutateOverride === false ? false : canMutateRole;
  const isOwner = useIsWorkspaceOwnerId();
  const { attachments, isLoading, error, refetch } = useOrderAttachments(orderId, { enabled });
  const upload = useUploadOrderAttachment(orderId);
  const remove = useDeleteOrderAttachment(orderId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<OrderAttachment | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OrderAttachment | null>(null);
  const busy = upload.isPending || remove.isPending;

  const driveFolderId = attachments.find((a) => a.driveFolderId)?.driveFolderId ?? null;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || busy || !canMutate) return;
    const files = Array.from(fileList);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    for (const file of files) {
      const invalid = validateOrderAttachmentFile(file);
      if (invalid) {
        toast.error(t(`orders.attachments.errors.${invalid}`), { id: "order-attachment-invalid" });
        continue;
      }
      try {
        await upload.mutateAsync(file);
      } catch {
        // Toast handled in mutation onError; stop the batch on hard failure.
        break;
      }
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || remove.isPending) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch {
      return;
    }
  }

  async function openExternal(attachment: OrderAttachment) {
    let url: string | null = null;
    try {
      url = await resolveOrderAttachmentUrl(attachment, "full");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.attachments.errors.signedUrlFailed"));
    } finally {
      if (url?.startsWith("blob:")) {
        // Give the new tab a moment to start loading before revoking.
        window.setTimeout(() => URL.revokeObjectURL(url!), 60_000);
      }
    }
  }

  return (
    <section className="min-w-0 space-y-3 border-t border-border pt-5" aria-labelledby="order-attachments-heading">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="order-attachments-heading" className="text-xs font-medium text-muted-foreground">
            {t("orders.attachments.title")}
          </h3>
          <p className="mt-0.5 text-xs text-subtle-foreground">{t("orders.attachments.subtitle")}</p>
          {isOwner && driveFolderId ? (
            <a
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(driveFolderId)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              {t("orders.attachments.openDriveFolder")}
            </a>
          ) : null}
        </div>
        {canMutate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => cameraInputRef.current?.click()}
              className="shrink-0"
            >
              <Camera className="size-3.5" />
              {upload.isPending ? t("orders.attachments.uploading") : t("orders.attachments.takePhoto")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0"
            >
              <Upload className="size-3.5" />
              {t("orders.attachments.addFiles")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {canMutateOverride === false
              ? t("orders.lifecycle.errors.closedOrderImmutable")
              : t("settings.subscription.readOnlyTitle")}
          </p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ORDER_ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        aria-label={t("orders.attachments.addFiles")}
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={t("orders.attachments.takePhoto")}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">{t("orders.attachments.errors.loadFailed")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : attachments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
          <Paperclip className="mx-auto size-5 text-subtle-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium text-foreground">{t("orders.attachments.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("orders.attachments.emptyHint")}</p>
        </div>
      ) : (
        <ul className="min-w-0 space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-2.5 shadow-xs sm:p-3"
            >
              <AttachmentThumb attachment={attachment} onOpen={() => setPreview(attachment)} />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium text-foreground" title={attachment.fileName}>
                  {attachment.fileName}
                  <ProviderBadge attachment={attachment} />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {attachment.mimeType || "—"} · {formatAttachmentBytes(attachment.fileSize, currentIntlLocale())}
                </p>
                <p className="mt-0.5 text-[11px] text-subtle-foreground tabular-nums">{formatUploadedAt(attachment.createdAt)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setPreview(attachment)}>
                    <Eye className="size-3.5" />
                    {t("orders.attachments.previewAction")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => void openExternal(attachment)}>
                    <Download className="size-3.5" />
                    {t("orders.attachments.download")}
                  </Button>
                  {canMutate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setPendingDelete(attachment)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("common.delete")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AttachmentPreviewDialog attachment={preview} open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)} />

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !remove.isPending && !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orders.attachments.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("orders.attachments.deleteDescription", { name: pendingDelete?.fileName ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)} disabled={remove.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={remove.isPending}>
              {remove.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
