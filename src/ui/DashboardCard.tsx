import { cn } from '../lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from './Skeleton';
import { statCardClassName, statIconVariants, statValueSizeClass, statValueTitle } from './statCardStyles';

interface DashboardCardProps {
  title: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  /** Secondary line under the value, e.g. a count or a short explanation. */
  footer?: React.ReactNode;
  isLoading?: boolean;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}

export function TrendBadge({ value, label }: { value: number; label: string }) {
  const up = value >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('rounded px-1 py-px font-medium tabular-nums', up ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
        {up ? '+' : ''}
        {value.toFixed(1)}%
      </span>
      {label}
    </span>
  );
}

export function DashboardCard({
  title,
  value,
  icon: Icon,
  trend,
  footer,
  isLoading,
  variant = 'default',
  className,
}: DashboardCardProps) {
  return (
    <div className={cn(statCardClassName, className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', statIconVariants[variant])}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
        )}
      </div>
      {isLoading ? (
        <>
          <Skeleton className="mt-2 h-7 w-28" />
          <Skeleton className="mt-2.5 h-3 w-20" />
        </>
      ) : (
        <>
          <p className={cn('mt-1 truncate leading-8 font-semibold tracking-tight text-foreground tabular-nums', statValueSizeClass(value))} title={statValueTitle(value)}>
            {value}
          </p>
          {trend && (
            <div className="mt-1.5">
              <TrendBadge value={trend.value} label={trend.label} />
            </div>
          )}
          {footer && <div className="mt-1.5 truncate text-xs text-muted-foreground">{footer}</div>}
        </>
      )}
    </div>
  );
}
