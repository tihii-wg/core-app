import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional content shown beside the title (e.g. a compact summary card). */
  aside?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, aside, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:justify-between',
        aside ? 'sm:items-center' : 'sm:items-end',
        className,
      )}
    >
      <div className={cn('min-w-0', aside && 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3')}>
        <div className="min-w-0">
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {aside}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
