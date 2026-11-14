import { AlertTriangle } from "lucide-react";
import { AdminApiError } from "@/data/adminApi";
import { useT } from "@/i18n/I18nProvider";
import { Button, Card } from "./ui";

export function errorKey(error: unknown) {
  return error instanceof AdminApiError ? error.messageKey : "errors.generic";
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const detail = error instanceof Error ? error.message : null;
  return (
    <Card className="flex flex-col gap-3 border-[color-mix(in_oklab,var(--danger)_40%,var(--border))] p-4 sm:flex-row sm:items-start">
      <AlertTriangle className="size-5 shrink-0 text-[var(--danger)]" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-[var(--fg)]">{t(errorKey(error))}</p>
        {detail && detail !== errorKey(error) ? <p className="break-words text-xs text-[var(--muted)]">{detail}</p> : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </Card>
  );
}
