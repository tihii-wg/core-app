import { useMemo, useState, type ElementType } from "react";
import { TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight, CreditCard, Banknote, Building, FileText, Plus, EllipsisVertical, Pencil, Trash2, Receipt } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { PageHeader } from "../../pages/PageHeader";
import { DashboardCard } from "../../ui/DashboardCard";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import type { Expense, PaymentMethod, Transaction } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageExpenses } from "../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { rangeLabel, reportRanges, useReportFormatting } from "../reports/reportFormatting";
import { reportPeriod, type ReportRange } from "../reports/reportStats";
import { useFinanceTransactions } from "./useFinanceTransactions";
import { ExpenseFormDialog } from "./ExpenseFormDialog";
import { DeleteExpenseDialog } from "./DeleteExpenseDialog";

const paymentMethodIcons: Record<PaymentMethod, ElementType> = {
  cash: Banknote,
  card: CreditCard,
  "bank-transfer": Building,
  other: DollarSign,
};

function percent(part: number, whole: number) {
  return whole > 0 ? ((part / whole) * 100).toFixed(1) : "0";
}

export function Finance() {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const canManage = withSubscriptionWriteAccess(canManageExpenses(useActiveWorkspaceRole()), subscriptionAllowsWrite);
  const [range, setRange] = useState<ReportRange>("last30");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const { transactions, outstanding, isLoading, invoicesError, expensesError, invoicesUnavailable, expensesUnavailable } = useFinanceTransactions();

  const period = useMemo(() => reportPeriod(range, new Date()), [range]);
  const inPeriod = useMemo(() => transactions.filter((txn) => txn.date >= period.start && txn.date <= period.end), [transactions, period]);

  const stats = useMemo(() => {
    const income = inPeriod.filter((txn) => txn.type === "income").reduce((sum, txn) => sum + txn.amount, 0);
    const expenseRows = inPeriod.filter((txn) => txn.type === "expense");
    const expenses = expenseRows.reduce((sum, txn) => sum + txn.amount, 0);
    const byCategory = Object.entries(
      expenseRows.reduce<Record<string, number>>((acc, txn) => {
        acc[txn.category] = (acc[txn.category] ?? 0) + txn.amount;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);
    const byMethod = Object.entries(
      expenseRows.reduce<Record<string, number>>((acc, txn) => {
        const method = txn.paymentMethod ?? "other";
        acc[method] = (acc[method] ?? 0) + txn.amount;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]) as [PaymentMethod, number][];
    const outstandingTotal = outstanding.reduce((sum, invoice) => sum + invoice.amount, 0);
    return { income, expenses, profit: income - expenses, byCategory, byMethod, outstandingTotal };
  }, [inPeriod, outstanding]);

  const knownCategories = useMemo(() => [...new Set(transactions.filter((txn) => txn.type === "expense").map((txn) => txn.category))], [transactions]);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: t("finance.transactions.columns.date"),
      cell: (txn) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(txn.date)}</span>,
    },
    {
      key: "type",
      header: t("finance.transactions.columns.type"),
      cell: (txn) =>
        txn.type === "income" ? (
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <span className="text-success">{t("finance.transactions.types.income")}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ArrowDownRight className="h-4 w-4 text-destructive" />
            <span className="text-destructive">{t("finance.transactions.types.expense")}</span>
          </div>
        ),
    },
    {
      key: "category",
      header: t("finance.transactions.columns.category"),
      cell: (txn) => <StatusBadge variant="default">{txn.category}</StatusBadge>,
      className: "hidden sm:table-cell",
    },
    {
      key: "description",
      header: t("finance.transactions.columns.description"),
      cell: (txn) => (
        <div className="max-w-[12rem] truncate xl:max-w-xs" title={txn.description}>
          {txn.description || t("common.noValue")}
        </div>
      ),
      className: "hidden md:table-cell",
    },
    {
      key: "paymentMethod",
      header: t("finance.transactions.columns.method"),
      cell: (txn) => {
        if (!txn.paymentMethod) {
          return (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="text-sm">{t("finance.transactions.invoiceMethod")}</span>
            </div>
          );
        }
        const Icon = paymentMethodIcons[txn.paymentMethod];
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span className="text-sm">{t(`finance.paymentMethods.short.${txn.paymentMethod}`)}</span>
          </div>
        );
      },
      className: "hidden xl:table-cell",
    },
    {
      key: "amount",
      header: t("finance.transactions.columns.amount"),
      cell: (txn) => (
        <span className={`whitespace-nowrap font-medium tabular-nums ${txn.type === "income" ? "text-success" : "text-destructive"}`}>
          {txn.type === "income" ? "+" : "-"}
          {formatMoney(txn.amount)}
        </span>
      ),
      className: "text-right",
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: t("common.actions"),
            cell: (txn: Transaction) =>
              txn.expense ? (
                <ExpenseActionsMenu
                  expense={txn.expense}
                  onEdit={(expense) => {
                    setEditing(expense);
                    setFormOpen(true);
                  }}
                  onDelete={setDeleting}
                />
              ) : null,
            className: "w-10 text-right",
          } satisfies Column<Transaction>,
        ]
      : []),
  ];

  const description = isLoading ? t("common.loadingEllipsis") : t("finance.periodDescription", { range: rangeLabel(range) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("finance.title")}
        description={description}
        actions={
          <>
            <Select value={range} onValueChange={(value) => setRange(value as ReportRange)}>
              <SelectTrigger className="w-40" aria-label={t("finance.rangeLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reportRanges.map((value) => (
                  <SelectItem key={value} value={value}>
                    {rangeLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && !expensesUnavailable && (
              <Button onClick={openAdd}>
                <Plus />
                {t("finance.expenses.add")}
              </Button>
            )}
          </>
        }
      />

      <SubscriptionReadOnlyNotice />

      {(invoicesUnavailable || expensesUnavailable || invoicesError || expensesError) && (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
          {invoicesUnavailable && <p>{t("invoices.errors.unavailable")}</p>}
          {expensesUnavailable && <p>{t("finance.expenses.errors.unavailable")}</p>}
          {invoicesError && <p>{invoicesError.message}</p>}
          {expensesError && <p>{expensesError.message}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardCard title={t("finance.stats.totalRevenue")} value={formatMoney(stats.income)} icon={TrendingUp} variant="success" />
        <DashboardCard title={t("finance.stats.totalExpenses")} value={formatMoney(stats.expenses)} icon={TrendingDown} variant="danger" />
        <DashboardCard title={t("finance.stats.netProfit")} value={formatMoney(stats.profit)} icon={DollarSign} variant={stats.profit >= 0 ? "primary" : "danger"} />
        <DashboardCard title={t("finance.stats.outstanding")} value={formatMoney(stats.outstandingTotal)} icon={FileText} variant="warning" />
      </div>

      <div className="grid gap-5 2xl:grid-cols-3">
        <div className="min-w-0 2xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{t("finance.transactions.title")}</h2>
          <DataTable
            columns={columns}
            data={inPeriod}
            keyExtractor={(txn) => txn.id}
            emptyState={
              <EmptyState
                icon={Receipt}
                title={t("finance.empty.title")}
                description={t("finance.empty.description")}
                action={canManage && !expensesUnavailable ? { label: t("finance.expenses.add"), onClick: openAdd } : undefined}
              />
            }
          />
        </div>

        <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
          <div className="rounded-lg border border-border bg-card p-5 shadow-xs">
            <h3 className="mb-4 text-sm font-semibold text-foreground">{t("finance.profitOverview.title")}</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("finance.profitOverview.revenue")}</span>
                <span className="text-sm font-medium text-success">+{formatMoney(stats.income)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("finance.profitOverview.expenses")}</span>
                <span className="text-sm font-medium text-destructive">-{formatMoney(stats.expenses)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="text-sm font-medium text-foreground">{t("finance.profitOverview.netProfit")}</span>
                <span className={`text-lg font-semibold tabular-nums ${stats.profit >= 0 ? "text-success" : "text-destructive"}`}>{formatMoney(stats.profit)}</span>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                <Trans i18nKey="finance.profitOverview.margin" values={{ value: percent(stats.profit, stats.income) }} components={{ value: <span className="font-medium" /> }} />
              </p>
            </div>
          </div>

          <BreakdownCard
            title={t("finance.expensesByCategory")}
            empty={t("finance.noExpensesInPeriod")}
            rows={stats.byCategory.map(([category, amount]) => ({ key: category, label: category, amount }))}
            total={stats.expenses}
            formatMoney={formatMoney}
          />

          <BreakdownCard
            title={t("finance.expensesByPaymentMethod")}
            empty={t("finance.noExpensesInPeriod")}
            rows={stats.byMethod.map(([method, amount]) => ({ key: method, label: t(`finance.paymentMethods.full.${method}`), amount, icon: paymentMethodIcons[method] }))}
            total={stats.expenses}
            formatMoney={formatMoney}
          />
        </div>
      </div>

      <ExpenseFormDialog
        open={formOpen}
        expense={editing}
        knownCategories={knownCategories}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
      <DeleteExpenseDialog expense={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

type BreakdownRow = { key: string; label: string; amount: number; icon?: ElementType };

function BreakdownCard({ title, empty, rows, total, formatMoney }: { title: string; empty: string; rows: BreakdownRow[]; total: number; formatMoney: (value: number) => string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-xs">
      <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-4">
          {rows.map(({ key, label, amount, icon: Icon }) => {
            const share = percent(amount, total);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate text-sm text-foreground">{label}</span>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-foreground">{formatMoney(amount)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{share}%</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExpenseActionsMenu({ expense, onEdit, onDelete }: { expense: Expense; onEdit: (expense: Expense) => void; onDelete: (expense: Expense) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("finance.expenses.actions.menuLabel", { category: expense.category })}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onEdit(expense)}>
          <Pencil />
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(expense)}>
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
