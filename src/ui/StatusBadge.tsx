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

// Order status badge
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config: Record<OrderStatus, { label: string; variant: BadgeVariant }> = {
    new: { label: 'New', variant: 'info' },
    'in-progress': { label: 'In Progress', variant: 'warning' },
    'waiting-parts': { label: 'Waiting Parts', variant: 'violet' },
    completed: { label: 'Completed', variant: 'success' },
    paid: { label: 'Paid', variant: 'success' },
    cancelled: { label: 'Cancelled', variant: 'muted' },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant} dot>{label}</StatusBadge>;
}

// Payment status badge
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const config: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
    unpaid: { label: 'Unpaid', variant: 'danger' },
    partial: { label: 'Partial', variant: 'warning' },
    paid: { label: 'Paid', variant: 'success' },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}

// Invoice status badge
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const config: Record<InvoiceStatus, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Draft', variant: 'muted' },
    sent: { label: 'Sent', variant: 'info' },
    paid: { label: 'Paid', variant: 'success' },
    overdue: { label: 'Overdue', variant: 'danger' },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant} dot>{label}</StatusBadge>;
}

// Inventory status badge
export function InventoryStatusBadge({ status }: { status: "in_stock" | "low_stock" | "out_of_stock" }) {
  const config: Record<string, { label: string; variant: BadgeVariant }> = {
    in_stock: { label: "In Stock", variant: "success" },
    low_stock: { label: "Low Stock", variant: "warning" },
    out_of_stock: { label: "Out of Stock", variant: "danger" },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant} dot>{label}</StatusBadge>;
}