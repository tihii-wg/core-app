import { useEffect, useRef, useState, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { orderTotalBreakdown } from "./orderTotalBreakdown";

type Props = {
  order: Pick<Order, "services" | "materials" | "totalPrice">;
  formatMoney: (value: number) => string;
  worksLabel: string;
  materialsLabel: string;
  children: ReactNode;
};

/**
 * Hover (desktop) / tap (touch) breakdown of the order total:
 * works vs materials, and works per performer when there is more than one.
 */
export function OrderTotalBreakdownPopover({ order, formatMoney, worksLabel, materialsLabel, children }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Tap outside closes it (tooltips have no outside-click dismissal on touch screens).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || contentRef.current?.contains(target))) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  const breakdown = orderTotalBreakdown(order, t("orders.totalBreakdown.unassigned"));
  const hasLines = (order.services?.length ?? 0) + (order.materials?.length ?? 0) > 0;

  if (!hasLines) return <>{children}</>;

  const cancelClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const showWorkers =
    breakdown.workers.length > 1 || (breakdown.workers.length === 1 && breakdown.workers[0].employeeId !== null);

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
    <TooltipPrimitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : scheduleClose())}>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          className="cursor-help rounded-sm text-right underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          aria-label={t("orders.totalBreakdown.ariaLabel")}
          ref={triggerRef}
          onClick={(event) => {
            // Touch / keyboard: tap toggles (hover does not exist on phones).
            event.preventDefault();
            cancelClose();
            setOpen((value) => !value);
          }}
        >
          {children}
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={contentRef}
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={16}
        className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-left text-sm font-normal tracking-normal text-popover-foreground shadow-md"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        data-testid="order-total-breakdown"
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("orders.totalBreakdown.title")}</p>
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-foreground">{worksLabel}</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(breakdown.works)}</dd>
          </div>
          {showWorkers ? (
            <div className="space-y-1 border-l-2 border-border pl-2">
              {breakdown.workers.map((worker) => (
                <div key={worker.employeeId ?? "none"} className="flex justify-between gap-3 text-xs">
                  <dt className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground">
                    {worker.name}
                    <span className="ml-1 text-subtle-foreground">
                      ({t("orders.totalBreakdown.linesCount", { count: worker.lines })})
                    </span>
                  </dt>
                  <dd className="shrink-0 tabular-nums text-foreground">{formatMoney(worker.amount)}</dd>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-foreground">{materialsLabel}</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatMoney(breakdown.materials)}</dd>
          </div>
          {breakdown.discount > 0 ? (
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <dt>{t("orders.totalBreakdown.discountIncluded")}</dt>
              <dd className="tabular-nums">−{formatMoney(breakdown.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
            <dt>{t("orders.totalBreakdown.total")}</dt>
            <dd className="tabular-nums">{formatMoney(order.totalPrice)}</dd>
          </div>
        </dl>
      </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
