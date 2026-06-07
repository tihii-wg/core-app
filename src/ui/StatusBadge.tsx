import { cn } from '../lib/utils';
import type { OrderStatus, PaymentStatus, InvoiceStatus } from '../lib/types';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[#eeeeef] text-[#282e33]',
  success: 'bg-[#e6f7ed] text-[#099b49]',
  warning: 'bg-[#fff4e5] text-[#f89200]',
  danger: 'bg-[#fee7e7] text-[#f41f20]',
  info: 'bg-[#edf4fd] text-[#1973e1]',
  muted: 'bg-[#f1f3f5] text-[#939699]',
};

export function StatusBadge({ variant = 'default', children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

// Order status badge
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config: Record<OrderStatus, { label: string; variant: BadgeVariant }> = {
    new: { label: 'New', variant: 'info' },
    'in-progress': { label: 'In Progress', variant: 'warning' },
    'waiting-parts': { label: 'Waiting Parts', variant: 'muted' },
    completed: { label: 'Completed', variant: 'success' },
    paid: { label: 'Paid', variant: 'success' },
    cancelled: { label: 'Cancelled', variant: 'danger' },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
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
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}

// Inventory status badge
export function InventoryStatusBadge({ status }: { status: 'in-stock' | 'low-stock' | 'out-of-stock' }) {
  const config: Record<string, { label: string; variant: BadgeVariant }> = {
    'in-stock': { label: 'In Stock', variant: 'success' },
    'low-stock': { label: 'Low Stock', variant: 'warning' },
    'out-of-stock': { label: 'Out of Stock', variant: 'danger' },
  };

  const { label, variant } = config[status];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}
