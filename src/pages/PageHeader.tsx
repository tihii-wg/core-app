

import { cn } from '../lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div>
        <h1 className="text-xl font-semibold text-[#282e33]">{title}</h1>
        {description && (
          <p className="text-sm text-[#939699] mt-0.5">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 mt-3 sm:mt-0">
          {actions}
        </div>
      )}
    </div>
  );
}
