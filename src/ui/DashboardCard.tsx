

import { cn } from '../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface DashboardCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}

const iconVariants = {
  default: 'bg-[#f1f3f5] text-[#939699]',
  primary: 'bg-[#edf4fd] text-[#1973e1]',
  success: 'bg-[#e6f7ed] text-[#099b49]',
  warning: 'bg-[#fff4e5] text-[#f89200]',
  danger: 'bg-[#fee7e7] text-[#f41f20]',
};

export function DashboardCard({
  title,
  value,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: DashboardCardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-md border border-[#eeeeef] p-4',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-[#939699] font-medium">{title}</p>
          <p className="text-2xl font-semibold text-[#282e33] mt-1">{value}</p>
          {trend && (
            <p
              className={cn(
                'text-xs mt-1',
                trend.value >= 0 ? 'text-[#099b49]' : 'text-[#f41f20]'
              )}
            >
              {trend.value >= 0 ? '+' : ''}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('p-2 rounded-md', iconVariants[variant])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
