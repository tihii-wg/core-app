import { useEffect, type ReactNode } from "react";
import { Info, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";
import { cn } from "../lib/utils";

export type ConfirmDialogTone = "default" | "destructive";
export type ConfirmDialogIcon = "warning" | "danger" | "info";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  icon?: ConfirmDialogIcon;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function ConfirmIcon({ kind, tone }: { kind: ConfirmDialogIcon; tone: ConfirmDialogTone }) {
  const Icon = kind === "danger" ? Trash2 : kind === "info" ? Info : TriangleAlert;
  const destructive = tone === "destructive" || kind === "danger" || kind === "warning";
  return (
    <div
      className={cn(
        "mb-1 flex size-10 shrink-0 items-center justify-center rounded-full",
        destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
      aria-hidden
    >
      <Icon className="size-5" />
    </div>
  );
}

/**
 * Presentational confirmation dialog. Prefer `useConfirm()` for imperative prompts.
 * Built on Dialog + Button only (not alert-dialog).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  icon,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedIcon = icon ?? (tone === "destructive" ? "danger" : undefined);
  const confirmText = confirmLabel ?? t("common.confirm");
  const cancelText = cancelLabel ?? t("common.cancel");
  const hasDescription = description != null && description !== "";

  useEffect(() => {
    if (!open || tone !== "destructive") return;
    const id = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, tone]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton={!isPending}
        {...(hasDescription ? {} : { "aria-describedby": undefined })}
        onClick={stopBubble}
        onPointerDown={stopBubble}
        onKeyDown={(event) => {
          // Enter activates only the focused footer button — never confirms from elsewhere.
          if (event.key !== "Enter") return;
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-confirm-ok], [data-confirm-cancel]")) return;
          event.preventDefault();
        }}
      >
        <DialogHeader>
          {resolvedIcon ? <ConfirmIcon kind={resolvedIcon} tone={tone} /> : null}
          <DialogTitle>{title}</DialogTitle>
          {hasDescription ? (
            typeof description === "string" ? (
              <DialogDescription>{description}</DialogDescription>
            ) : (
              <div className="text-muted-foreground text-[13px] leading-5">{description}</div>
            )
          ) : null}
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} data-confirm-cancel onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={isPending}
            loading={isPending}
            data-confirm-ok
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
