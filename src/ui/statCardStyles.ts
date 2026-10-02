import type { ReactNode } from 'react';

export const statCardClassName =
  'group relative flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow] duration-150 sm:p-5';

export const statIconVariants = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

// Large monetary values step down a size instead of being cut off in narrow cards.
export function statValueSizeClass(value: ReactNode) {
  const length = typeof value === 'string' || typeof value === 'number' ? String(value).length : 0;
  if (length > 16) return 'text-lg';
  if (length > 12) return 'text-xl';
  return 'text-2xl';
}

export function statValueTitle(value: ReactNode) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
