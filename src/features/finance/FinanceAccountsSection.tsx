import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { FinanceTransferDialog } from "./FinanceTransferDialog";
import { useFinanceAccounts } from "./useFinanceAccounts";
import { DEFAULT_VAT_RATE_PERCENT } from "./vat";

function formatAccountAmount(value: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`;
  }
}

/** Stage 4: cash accounts (`finance_accounts`) with balances and account-to-account transfers. */
export function FinanceAccountsSection() {
  const { t } = useTranslation();
  const { data = [], isLoading, error } = useFinanceAccounts();
  const [transferOpen, setTransferOpen] = useState(false);
  // Transfers only make sense between active accounts.
  const transferAccounts = data.filter((account) => account.isActive);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-xs" aria-labelledby="finance-accounts-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="finance-accounts-title" className="text-sm font-semibold text-foreground">
            {t("finance.accounts.title")}
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">{t("finance.accounts.description")}</p>
        </div>
        {transferAccounts.length >= 2 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="size-4" />
            {t("finance.accounts.transfer.open")}
          </Button>
        ) : null}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">{t("finance.accounts.loading")}</p> : null}
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {!isLoading && !error && data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("finance.accounts.empty")}</p>
      ) : null}

      {data.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{account.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`finance.accounts.types.${account.accountType}`)}
                  {" · "}
                  {t(`finance.accounts.scopes.${account.scope}`)}
                  {account.isVirtual ? ` · ${t("finance.accounts.virtual")}` : ""}
                  {account.isActive ? "" : ` · ${t("finance.accounts.inactive")}`}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                {account.balance == null
                  ? t("common.noValue")
                  : formatAccountAmount(account.balance, account.currencyCode)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("finance.accounts.vatTip", { rate: DEFAULT_VAT_RATE_PERCENT, divisor: 100 + DEFAULT_VAT_RATE_PERCENT })}
        </p>
      ) : null}

      {transferAccounts.length >= 2 ? (
        <FinanceTransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={transferAccounts} />
      ) : null}
    </section>
  );
}
