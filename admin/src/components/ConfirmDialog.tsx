import type { ReactNode } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Button } from "./ui";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmDisabled = true,
  disabledReason,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  disabledReason?: string;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--fg)]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        {disabledReason ? (
          <p className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
            {disabledReason}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel ?? t("common.manage")}
          </Button>
        </div>
      </div>
    </div>
  );
}
