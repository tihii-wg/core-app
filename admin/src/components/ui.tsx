import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90",
        variant === "secondary" && "border border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[color-mix(in_oklab,var(--bg)_70%,var(--border))]",
        variant === "danger" && "bg-[var(--danger)] text-white hover:opacity-90",
        variant === "ghost" && "hover:bg-[color-mix(in_oklab,var(--bg)_70%,var(--border))]",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "muted" && "bg-[color-mix(in_oklab,var(--muted)_18%,transparent)] text-[var(--muted)]",
        tone === "success" && "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]",
        tone === "warning" && "bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] text-[var(--warning)]",
        tone === "danger" && "bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] text-[var(--danger)]",
        tone === "info" && "bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] text-[var(--primary)]",
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg)]">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--muted)]">{description}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-[color-mix(in_oklab,var(--muted)_18%,transparent)]", className)} />;
}
