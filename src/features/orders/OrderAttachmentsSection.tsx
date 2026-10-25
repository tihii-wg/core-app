import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Download, Eye, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Skeleton } from "../../ui/Skeleton";
import { currentIntlLocale } from "../../i18n";
import {
  formatAttachmentBytes,
  isImageMimeType,
  ORDER_ATTACHMENT_ACCEPT,
  validateOrderAttachmentFile,
  type OrderAttachment,
} from "./orderAttachments";
import { createOrderAttachmentSignedUrl } from "../../services/apiOrderAttachments";
import {
  useCanMutateOrderAttachments,
  useDeleteOrderAttachment,
  useOrderAttachmentSignedUrl,
  useOrderAttachments,
  useUploadOrderAttachment,
} from "./useOrderAttachments";
import toast from "react-hot-toast";

type OrderAttachmentsSectionProps = {
  orderId: string;
  /** When false, the panel is closed — skip fetching. */
  enabled?: boolean;
};

function formatUploadedAt(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "—";
  return date.toLocaleString(currentIntlLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function AttachmentThumb({ attachment, onOpen }: { attachment: OrderAttachment; onOpen: () => void }) {
  const { t } = useTranslation();
  const isImage = isImageMimeType(attachment.mimeType);
  const { data: url, isLoading, isError } = useOrderAttachmentSignedUrl(attachment.storagePath, { enabled: isImage });

  if (!isImage) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted"
        aria-label={t("orders.attachments.open", { name: attachment.fileName })}
      >
        <FileText className="size-6" aria-hidden />
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
  const { data: url, isLoading, isError, refetch } = useOrderAttachmentSignedUrl(attachment?.storagePath, {
    enabled: open && Boolean(attachment),
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
                <a href={url} target="_blank" rel="noreferrer">
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

export default function OrderAttachmentsSection({ orderId, enabled = true }: OrderAttachmentsSectionProps) {
  const { t } = useTranslation();
  const canMutate = useCanMutateOrderAttachments();
  const { attachments, isLoading, error, refetch } = useOrderAttachments(orderId, { enabled });
  const upload = useUploadOrderAttachment(orderId);
  const remove = useDeleteOrderAttachment(orderId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<OrderAttachment | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OrderAttachment | null>(null);
  const busy = upload.isPending || remove.isPending;

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
    try {
      const url = await createOrderAttachmentSignedUrl(attachment.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.attachments.errors.signedUrlFailed"));
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
          <p className="text-xs text-muted-foreground">{t("orders.attachments.viewOnlyHint")}</p>
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
