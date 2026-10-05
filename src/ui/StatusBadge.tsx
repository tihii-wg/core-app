import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { OrderStatus, PaymentStatus, InvoiceStatus } from '../lib/types';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'violet';

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  /** Leading status dot; on by default for status-like variants. */
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-secondary text-secondary-foreground ring-border-strong/60',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  danger: 'bg-destructive/10 text-destructive ring-destructive/20',
  info: 'bg-info/10 text-info ring-info/20',
  muted: 'bg-muted text-muted-foreground ring-border-strong/60',
  violet: 'bg-chart-4/10 text-chart-4 ring-chart-4/20',
};

const dotStyles: Record<BadgeVariant, string> = {
  default: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-subtle-foreground',
  violet: 'bg-chart-4',
};

export function StatusBadge({ variant = 'default', children, className, dot = false }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium leading-none ring-1 ring-inset',
        variantStyles[variant],
        className
      )}
    >
      {dot && <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dotStyles[variant])} />}
      {children}
    </span>
  );
}

const orderVariants: Record<OrderStatus, BadgeVariant> = {
  new: 'info',
  'in-progress': 'warning',
  'waiting-parts': 'violet',
  completed: 'success',
  paid: 'success',
  cancelled: 'muted',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <StatusBadge variant={orderVariants[status]} dot>{t(`status.order.${status}`)}</StatusBadge>;
}

const paymentVariants: Record<PaymentStatus, BadgeVariant> = { unpaid: 'danger', partial: 'warning', paid: 'success' };

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  return <StatusBadge variant={paymentVariants[status]}>{t(`status.payment.${status}`)}</StatusBadge>;
}

const invoiceVariants: Record<InvoiceStatus, BadgeVariant> = { draft: 'muted', sent: 'info', paid: 'success', overdue: 'danger' };

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  return <StatusBadge variant={invoiceVariants[status]} dot>{t(`status.invoice.${status}`)}</StatusBadge>;
}

type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock";
const inventoryVariants: Record<InventoryStatus, BadgeVariant> = { in_stock: "success", low_stock: "warning", out_of_stock: "danger" };

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  const { t } = useTranslation();
  return <StatusBadge variant={inventoryVariants[status]} dot>{t(`status.inventory.${status}`)}</StatusBadge>;
}