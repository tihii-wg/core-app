import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

export function DemoBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full bg-info/10 px-2 text-[11px] font-medium text-info ring-1 ring-info/20 ring-inset", className)}>
      {t("common.demo.label")}
    </span>
  );
}

export function DemoDataNotice({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="note" aria-label={t("common.demo.label")} className={cn("flex items-start gap-3 rounded-lg border border-info/25 bg-info/5 px-4 py-3", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
        <FlaskConical aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 text-[13px] leading-5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          <DemoBadge />
          {title}
        </p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
