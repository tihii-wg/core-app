import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";

type Props = {
  onRefresh: () => void;
  onDismiss: () => void;
  refreshing?: boolean;
};

/** Non-blocking banner when the open dirty order changed on another device. */
export function RemoteOrderEditNotice({ onRefresh, onDismiss, refreshing }: Props) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      data-testid="remote-order-edit-notice"
      className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="min-w-0 flex-1">{t("orders.detail.remoteChanged")}</p>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDismiss} disabled={refreshing}>
          {t("orders.detail.remoteChangedDismiss")}
        </Button>
        <Button type="button" size="sm" onClick={onRefresh} disabled={refreshing}>
          {t("orders.detail.remoteChangedRefresh")}
        </Button>
      </div>
    </div>
  );
}
