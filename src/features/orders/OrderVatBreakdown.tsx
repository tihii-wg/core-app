import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { OrderVatBreakdown as VatBreakdown } from "../finance/orderVat";

type OrderVatBreakdownProps = {
  breakdown: VatBreakdown | null;
  formatMoney: (amount: number) => string;
  /** When true and breakdown is null, show the muted “set rate in settings” hint. */
  showNoRateHint?: boolean;
  className?: string;
  testId?: string;
};

/** Shared “Без НДС / НДС X% / Итого с НДС” block for forms, detail, and invoices. */
export function OrderVatBreakdownView({
  breakdown,
  formatMoney,
  showNoRateHint = false,
  className,
  testId = "order-vat-breakdown",
}: OrderVatBreakdownProps) {
  const { t } = useTranslation();
  const { locale = "en", workspaceId = "" } = useParams();

  if (!breakdown) {
    if (!showNoRateHint) return null;
    return (
      <p className={className ?? "mt-2 text-xs text-muted-foreground"} data-testid={`${testId}-hint`}>
        {t("orders.vat.noRate")}{" "}
        <Link
          to={workspaceId ? `/${locale}/${workspaceId}/settings?tab=taxes` : `/${locale}/settings?tab=taxes`}
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        >
          {t("orders.vat.setRate")}
        </Link>
      </p>
    );
  }

  return (
    <dl className={className ?? "mt-2 space-y-0.5 text-sm text-muted-foreground"} data-testid={testId}>
      <div className="flex justify-between gap-3">
        <dt>{t("orders.vat.net")}</dt>
        <dd className="tabular-nums" data-testid={`${testId}-net`}>
          {formatMoney(breakdown.net)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>{t("orders.vat.vat", { rate: breakdown.rate })}</dt>
        <dd className="tabular-nums" data-testid={`${testId}-vat`}>
          {formatMoney(breakdown.vat)}
        </dd>
      </div>
      <div className="flex justify-between gap-3 font-medium text-foreground">
        <dt>{t("orders.vat.gross")}</dt>
        <dd className="tabular-nums" data-testid={`${testId}-gross`}>
          {formatMoney(breakdown.gross)}
        </dd>
      </div>
    </dl>
  );
}
