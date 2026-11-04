import { useTranslation } from 'react-i18next';
import { industryOrderStatusLabel } from '../features/industries/industryWorkflow';
import { useIndustryWorkflow } from '../features/industries/useIndustryWorkflow';
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
        // min-w-0 + wrap-friendly text so long EN/RO/RU labels stay inside narrow cards;
        // min-h keeps the single-line look while multi-line labels grow vertically.
        'inline-flex min-h-5.5 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium leading-snug ring-1 ring-inset [overflow-wrap:anywhere]',
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
  closed: 'muted',
};

/** Custom status chip: tinted plate + readable foreground (docs §5.17). */
export function EntityStatusBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  const safeColor = color && /^#[0-9A-Fa-f]{3,8}$/.test(color.trim()) ? color.trim() : null;
  if (!safeColor) {
    return (
      <StatusBadge variant="default" dot className={className}>
        {name}
      </StatusBadge>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-h-5.5 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium leading-snug text-foreground ring-1 ring-inset ring-border-strong/40 [overflow-wrap:anywhere]",
        className,
      )}
      style={{ background: `color-mix(in srgb, ${safeColor} 14%, var(--card))` }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full dark:hidden"
        style={{ background: `color-mix(in srgb, ${safeColor} 80%, black)` }}
      />
      <span
        aria-hidden="true"
        className="hidden size-1.5 shrink-0 rounded-full dark:inline-block"
        style={{ background: `color-mix(in srgb, ${safeColor} 65%, white)` }}
      />
      {name}
    </span>
  );
}

export function OrderStatusBadge({
  status,
  customStatus,
}: {
  status: OrderStatus;
  customStatus?: { name: string; color?: string | null } | null;
}) {
  const { workflow } = useIndustryWorkflow();
  // Formal lifecycle states are authoritative: a stale or renamed custom status
  // must never hide system cancelled/closed (including a custom named "Cancelled").
  if (status === "cancelled" || status === "closed") {
    return (
      <StatusBadge variant={orderVariants[status]} dot>
        {industryOrderStatusLabel(workflow, status)}
      </StatusBadge>
    );
  }
  if (customStatus?.name) {
    return <EntityStatusBadge name={customStatus.name} color={customStatus.color} />;
  }
  return (
    <StatusBadge variant={orderVariants[status]} dot>
      {industryOrderStatusLabel(workflow, status)}
    </StatusBadge>
  );
}

const paymentVariants: Record<PaymentStatus, BadgeVariant> = { unpaid: 'danger', partial: 'warning', paid: 'success' };

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  return <StatusBadge variant={paymentVariants[status]}>{t(`status.payment.${status}`)}</StatusBadge>;
}

const invoiceVariants: Record<InvoiceStatus, BadgeVariant> = {
  draft: "muted",
  sent: "info",
  paid: "success",
  overdue: "danger",
  erroneous: "danger",
};

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