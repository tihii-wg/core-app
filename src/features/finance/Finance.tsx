import { useMemo, type ElementType } from "react";
import { TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight, CreditCard, Banknote, Building } from "lucide-react";
import { PageHeader } from "../../pages/PageHeader";
import { DashboardCard } from "../../ui/DashboardCard";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import type { Transaction } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { DemoDataNotice } from "../demo/DemoDataNotice";
import { useFinanceTransactions } from "./useFinanceTransactions";

const paymentMethodIcons: Record<string, ElementType> = {
  cash: Banknote,
  card: CreditCard,
  "bank-transfer": Building,
  other: DollarSign,
};

export function Finance() {
  const { data: transactions, isDemo } = useFinanceTransactions();
  const { formatMoney } = useWorkspaceMoney();

  // Calculate summaries
  const stats = useMemo(() => {
    const income = transactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
    const profit = income - expenses;

    // Payment method breakdown
    const byPaymentMethod = transactions.reduce((acc, t) => {
      if (t.type === "income") {
        acc[t.paymentMethod] = (acc[t.paymentMethod] || 0) + t.amount;
      }
      return acc;
    }, {} as Record<string, number>);

    return { income, expenses, profit, byPaymentMethod };
  }, [transactions]);

  // Table columns
  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: "Date",
      cell: (txn) => <span className="text-muted-foreground">{txn.date}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (txn) => (
        <div className="flex items-center gap-2">
          {txn.type === "income" ? (
            <>
              <ArrowUpRight className="h-4 w-4 text-success" />
              <span className="text-success">Income</span>
            </>
          ) : (
            <>
              <ArrowDownRight className="h-4 w-4 text-destructive" />
              <span className="text-destructive">Expense</span>
            </>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (txn) => <StatusBadge variant="default">{txn.category}</StatusBadge>,
      className: "hidden sm:table-cell",
    },
    {
      key: "description",
      header: "Description",
      cell: (txn) => (
        <div className="max-w-[12rem] truncate xl:max-w-xs" title={txn.description}>
          {txn.description}
        </div>
      ),
      className: "hidden md:table-cell",
    },
    {
      key: "paymentMethod",
      header: "Method",
      cell: (txn) => {
        const Icon = paymentMethodIcons[txn.paymentMethod] || DollarSign;
        const labels: Record<string, string> = {
          cash: "Cash",
          card: "Card",
          "bank-transfer": "Bank",
          other: "Other",
        };
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span className="text-sm">{labels[txn.paymentMethod]}</span>
          </div>
        );
      },
      className: "hidden xl:table-cell",
    },
    {
      key: "amount",
      header: "Amount",
      cell: (txn) => (
        <span className={`font-medium tabular-nums ${txn.type === "income" ? "text-success" : "text-destructive"}`}>
          {txn.type === "income" ? "+" : "-"}
          {formatMoney(txn.amount)}
        </span>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Finance" description={isDemo ? "Layout preview with sample transactions" : "Revenue, expenses, and profit overview"} />

      {isDemo && (
        <DemoDataNotice title="Finance is not connected to your workspace yet">
          All figures on this page are sample values for previewing the layout. They are not calculated from your orders, clients, or inventory.
        </DemoDataNotice>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <DashboardCard title="Total Revenue" value={formatMoney(stats.income)} icon={TrendingUp} variant="success" />
        <DashboardCard title="Total Expenses" value={formatMoney(stats.expenses)} icon={TrendingDown} variant="danger" />
        <DashboardCard title="Net Profit" value={formatMoney(stats.profit)} icon={DollarSign} variant={stats.profit >= 0 ? "primary" : "danger"} />
        <DashboardCard title="Transactions" value={transactions.length} icon={CreditCard} variant="default" />
      </div>

      {/* Main Content */}
      <div className="grid 2xl:grid-cols-3 gap-5">
        {/* Recent Transactions */}
        <div className="min-w-0 2xl:col-span-2">
          <h2 className="text-sm font-semibold text-foreground mb-3">Recent Transactions</h2>
          <DataTable columns={columns} data={transactions} keyExtractor={(txn) => txn.id} />
        </div>

        {/* Sidebar */}
        <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
          {/* Payment Method Breakdown */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-foreground mb-4">Revenue by Payment Method</h3>
            <div className="space-y-4">
              {Object.entries(stats.byPaymentMethod).map(([method, amount]) => {
                const Icon = paymentMethodIcons[method] || DollarSign;
                const labels: Record<string, string> = {
                  cash: "Cash",
                  card: "Card",
                  "bank-transfer": "Bank Transfer",
                  other: "Other",
                };
                const percentage = stats.income > 0 ? ((amount / stats.income) * 100).toFixed(1) : "0";
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">{labels[method]}</span>
                      </div>
                      <span className="text-sm font-medium text-foreground tabular-nums">{formatMoney(amount)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${percentage}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{percentage}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Profit Overview */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-foreground mb-4">Profit Overview</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Revenue</span>
                <span className="text-sm font-medium text-success">+{formatMoney(stats.income)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Expenses</span>
                <span className="text-sm font-medium text-destructive">-{formatMoney(stats.expenses)}</span>
              </div>
              <div className="border-t border-border pt-4 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Net Profit</span>
                <span className={`text-lg font-semibold tabular-nums ${stats.profit >= 0 ? "text-success" : "text-destructive"}`}>{formatMoney(stats.profit)}</span>
              </div>
              <div className="pt-2">
                <p className="text-xs text-muted-foreground">
                  Profit Margin: <span className="font-medium">{stats.income > 0 ? ((stats.profit / stats.income) * 100).toFixed(1) : "0"}%</span>
                </p>
              </div>
            </div>
          </div>

          {/* Expense Categories */}
          <div className="bg-card rounded-lg border border-border p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-foreground mb-4">Top Expenses</h3>
            <div className="space-y-3">
              {transactions
                .filter((t) => t.type === "expense")
                .slice(0, 4)
                .map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground">{expense.category}</p>
                      <p className="text-xs text-muted-foreground">{expense.date}</p>
                    </div>
                    <span className="text-sm font-medium text-destructive">-{formatMoney(expense.amount)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
