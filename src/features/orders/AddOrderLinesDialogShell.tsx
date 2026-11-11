import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";

type AddOrderLinesDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Inline save error (closed order, insufficient stock, ...); the dialog stays open. */
  error?: string | null;
  pending?: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void;
  children: ReactNode;
};

/**
 * Shell shared by the add-service / add-material dialogs: full-height bottom Sheet with a sticky
 * Cancel / Add footer below 640px, centered Dialog (max-w-lg) from 640px up.
 */
export default function AddOrderLinesDialogShell({
  open,
  onOpenChange,
  title,
  description,
  error,
  pending = false,
  submitDisabled = false,
  onSubmit,
  children,
}: AddOrderLinesDialogShellProps) {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const guardedOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  const body = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1" data-testid="add-order-lines-body">
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="add-order-lines-error">
          {error}
        </p>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex shrink-0 justify-end gap-2 border-t bg-elevated pt-3">
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
        {t("common.cancel")}
      </Button>
      <Button type="button" onClick={onSubmit} disabled={pending || submitDisabled} data-testid="add-order-lines-submit">
        {pending ? <Spinner className="h-4 w-4" /> : t("orders.addLines.submit")}
      </Button>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        {/* Fixed comfortable height: the catalog dropdowns open inside the scrolling body, so a
            content-sized dialog (one field tall) clipped the list and nothing could be picked. */}
        <DialogContent className="flex h-[min(640px,90vh)] max-h-[90vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {body}
          {footer}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={guardedOpenChange}>
      <SheetContent side="bottom" className="h-dvh max-h-dvh w-full gap-0 sm:max-w-none">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
          {body}
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  );
}
