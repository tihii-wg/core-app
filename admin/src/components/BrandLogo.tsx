import { cn } from "@/lib/cn";
import { useT } from "@/i18n/I18nProvider";

/** Exact Core App mark from `/core-app-logo.svg` (copied into admin/public). */
export function BrandLogoMark({ className, decorative = true }: { className?: string; decorative?: boolean }) {
  const t = useT();
  return (
    <img
      src="/core-app-logo.svg"
      alt={decorative ? "" : t("app.logoAlt")}
      width={32}
      height={32}
      decoding="async"
      className={cn("size-8 shrink-0 object-contain", className)}
      aria-hidden={decorative ? true : undefined}
      // Keep native colors in light/dark — no invert/filters.
      data-brand-logo="core-app"
    />
  );
}

export function BrandLockup({
  className,
  markClassName,
  nameClassName,
  subtitleClassName,
  showSubtitle = false,
}: {
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  subtitleClassName?: string;
  showSubtitle?: boolean;
}) {
  const t = useT();
  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <BrandLogoMark className={markClassName} />
      <div className="min-w-0">
        <p className={cn("truncate text-[15px] font-semibold tracking-tight text-[var(--fg)]", nameClassName)}>
          {t("app.brandName")}
        </p>
        {showSubtitle ? (
          <p className={cn("truncate text-xs text-[var(--muted)]", subtitleClassName)}>{t("app.subtitle")}</p>
        ) : null}
      </div>
    </div>
  );
}
