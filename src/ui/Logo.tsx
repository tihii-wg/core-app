import { useId } from "react";
import { cn } from "../lib/utils";

export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3a86f4" />
          <stop offset="1" stopColor="#1557c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <path d="M21.6 11.2a7.4 7.4 0 1 0 0 9.6" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.3" fill="#fff" />
    </svg>
  );
}

export default function Logo() {
  return (
    <div className="mb-2 inline-flex items-center gap-2.5">
      <LogoMark className="size-10" />
      <span className="text-2xl font-semibold tracking-tight text-foreground">Core App</span>
    </div>
  );
}
