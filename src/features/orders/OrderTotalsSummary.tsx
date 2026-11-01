import { useTranslation } from "react-i18next";
import type { OrderMoney } from "./orderTotals";

type OrderTotalsSummaryProps = {
  money: OrderMoney;
  formatMoney: (amount: number) => string;
  /** Percent labels of the client discounts that apply to new lines (add / edit forms). */
  clientDiscountPercents?: { services: number; products: number };
};

/** Subtotal / Discount / Total (final) block of the order forms. Total is exactly what gets persisted. */
export default function OrderTotalsSummary({ money, formatMoney, clientDiscountPercents }: OrderTotalsSummaryProps) {
  const { t } = useTranslation();
  const hasDiscount = money.discountTotal > 0;
  const services = clientDiscountPercents?.services ?? 0;
  const products = clientDiscountPercents?.products ?? 0;
  const clientNote = [
    services > 0 ? t("orders.form.clientDiscountServices", { percent: services }) : null,
    products > 0 ? t("orders.form.clientDiscountProducts", { percent: products }) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-1 border-t pt-3" data-testid="order-totals">
      {hasDiscount ? (
        <>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("orders.form.subtotal")}</span>
            <span className="tabular-nums" data-testid="order-subtotal">
              {formatMoney(money.subtotal)}
            </span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("orders.form.discount")}</span>
            <span className="tabular-nums" data-testid="order-discount">
              −{formatMoney(money.discountTotal)}
            </span>
          </div>
        </>
      ) : null}
      <div className="flex justify-between">
        <span className="text-lg font-semibold">{t("orders.form.totalPrice")}</span>
        <span className="tabular-nums" data-testid="order-total">
          {formatMoney(money.total)}
        </span>
      </div>
      {clientNote.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="client-discount-note">
          <p className="font-medium text-foreground">{clientNote.join(" · ")}</p>
          <p className="mt-0.5">{t("orders.form.clientDiscountApplied")}</p>
        </div>
      ) : null}
    </div>
  );
}
