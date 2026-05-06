

import { useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  CreditCard,
  Banknote,
  Building,
} from 'lucide-react';
import { PageHeader } from '../../pages/PageHeader';
import { DashboardCard } from '../../ui/DashboardCard';
import { DataTable, type Column } from '../../ui/DataTable';
import { StatusBadge } from '../../ui/StatusBadge';
import { useApp } from '../../lib/app-context';
import type { Transaction } from '../../lib/types';

const paymentMethodIcons: Record<string, React.ElementType> = {
  cash: Banknote,
  card: CreditCard,
  'bank-transfer': Building,
  other: DollarSign,
};

export function Finance() {
  const { transactions } = useApp();

  // Calculate summaries
  const stats = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    const profit = income - expenses;

    // Payment method breakdown
    const byPaymentMethod = transactions.reduce((acc, t) => {
      if (t.type === 'income') {
        acc[t.paymentMethod] = (acc[t.paymentMethod] || 0) + t.amount;
      }
      return acc;
    }, {} as Record<string, number>);

    return { income, expenses, profit, byPaymentMethod };
  }, [transactions]);

  // Table columns
  const columns: Column<Transaction>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (txn) => <span className="text-[#939699]">{txn.date}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (txn) => (
        <div className="flex items-center gap-2">
          {txn.type === 'income' ? (
            <>
              <ArrowUpRight className="h-4 w-4 text-[#099b49]" />
              <span className="text-[#099b49]">Income</span>
            </>
          ) : (
            <>
              <ArrowDownRight className="h-4 w-4 text-[#f41f20]" />
              <span className="text-[#f41f20]">Expense</span>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (txn) => <StatusBadge variant="default">{txn.category}</StatusBadge>,
      className: 'hidden sm:table-cell',
    },
    {
      key: 'description',
      header: 'Description',
      cell: (txn) => (
        <div className="max-w-xs truncate" title={txn.description}>
          {txn.description}
        </div>
      ),
      className: 'hidden md:table-cell',
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      cell: (txn) => {
        const Icon = paymentMethodIcons[txn.paymentMethod] || DollarSign;
        const labels: Record<string, string> = {
          cash: 'Cash',
          card: 'Card',
          'bank-transfer': 'Bank',
          other: 'Other',
        };
        return (
          <div className="flex items-center gap-1.5 text-[#939699]">
            <Icon className="h-4 w-4" />
            <span className="text-sm">{labels[txn.paymentMethod]}</span>
          </div>
        );
      },
      className: 'hidden lg:table-cell',
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (txn) => (
        <span
          className={`font-medium ${
            txn.type === 'income' ? 'text-[#099b49]' : 'text-[#f41f20]'
          }`}
        >
          {txn.type === 'income' ? '+' : '-'}${txn.amount}
        </span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Revenue, expenses, and profit overview"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardCard
          title="Total Revenue"
          value={`$${stats.income.toLocaleString()}`}
          icon={TrendingUp}
          variant="success"
        />
        <DashboardCard
          title="Total Expenses"
          value={`$${stats.expenses.toLocaleString()}`}
          icon={TrendingDown}
          variant="danger"
        />
        <DashboardCard
          title="Net Profit"
          value={`$${stats.profit.toLocaleString()}`}
          icon={DollarSign}
          variant={stats.profit >= 0 ? 'primary' : 'danger'}
        />
        <DashboardCard
          title="Transactions"
          value={transactions.length}
          icon={CreditCard}
          variant="default"
        />
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2">
          <h2 className="text-base font-semibold text-[#282e33] mb-4">
            Recent Transactions
          </h2>
          <DataTable
            columns={columns}
            data={transactions}
            keyExtractor={(txn) => txn.id}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Payment Method Breakdown */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h3 className="text-base font-semibold text-[#282e33] mb-4">
              Revenue by Payment Method
            </h3>
            <div className="space-y-4">
              {Object.entries(stats.byPaymentMethod).map(([method, amount]) => {
                const Icon = paymentMethodIcons[method] || DollarSign;
                const labels: Record<string, string> = {
                  cash: 'Cash',
                  card: 'Card',
                  'bank-transfer': 'Bank Transfer',
                  other: 'Other',
                };
                const percentage = stats.income > 0 
                  ? ((amount / stats.income) * 100).toFixed(1)
                  : '0';
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-[#939699]" />
                        <span className="text-sm text-[#282e33]">
                          {labels[method]}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-[#282e33]">
                        ${amount}
                      </span>
                    </div>
                    <div className="h-2 bg-[#eeeeef] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1973e1] rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-[#939699] mt-1">{percentage}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Profit Overview */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h3 className="text-base font-semibold text-[#282e33] mb-4">
              Profit Overview
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#939699]">Revenue</span>
                <span className="text-sm font-medium text-[#099b49]">
                  +${stats.income.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#939699]">Expenses</span>
                <span className="text-sm font-medium text-[#f41f20]">
                  -${stats.expenses.toLocaleString()}
                </span>
              </div>
              <div className="border-t border-[#eeeeef] pt-4 flex items-center justify-between">
                <span className="text-sm font-medium text-[#282e33]">
                  Net Profit
                </span>
                <span
                  className={`text-lg font-bold ${
                    stats.profit >= 0 ? 'text-[#099b49]' : 'text-[#f41f20]'
                  }`}
                >
                  ${stats.profit.toLocaleString()}
                </span>
              </div>
              <div className="pt-2">
                <p className="text-xs text-[#939699]">
                  Profit Margin:{' '}
                  <span className="font-medium">
                    {stats.income > 0
                      ? ((stats.profit / stats.income) * 100).toFixed(1)
                      : '0'}
                    %
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Expense Categories */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h3 className="text-base font-semibold text-[#282e33] mb-4">
              Top Expenses
            </h3>
            <div className="space-y-3">
              {transactions
                .filter((t) => t.type === 'expense')
                .slice(0, 4)
                .map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm text-[#282e33]">{expense.category}</p>
                      <p className="text-xs text-[#939699]">{expense.date}</p>
                    </div>
                    <span className="text-sm font-medium text-[#f41f20]">
                      -${expense.amount}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
