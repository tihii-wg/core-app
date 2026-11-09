import { useEffect, useRef, useState, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { orderTotalBreakdown } from "./orderTotalBreakdown";

/** Ignore hover right after the card opens (slide-in under a resting cursor). */
const HOVER_GRACE_MS = 700;

type Props = {
  order: Pick<Order, "services" | "materials" | "totalPrice">;
  formatMoney: (value: number) => string;
  worksLabel?: string;
  materialsLabel?: string;
  /** Extra classes for the trigger (e.g. text alignment inside list cells). */
  className?: string;
  children: ReactNode;
};

/**
 * Hover (desktop) / tap (touch) breakdown of the order total:
 * works vs materials, and works per performer when there is more than one.
 */
export function OrderTotalBreakdownPopover({
  order,
  formatMoney,
  worksLabel: worksLabelProp,
  materialsLabel: materialsLabelProp,
  className,
  children,
}: Props) {
  const { t } = useTranslation();
  const worksLabel = worksLabelProp ?? t("orders.totalBreakdown.works");
  const materialsLabel = materialsLabelProp ?? t("orders.detail.materials");
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const mountedAt = useRef(Date.now());
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Tap outside closes it (tooltips have no outside-click dismissal on touch screens).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || contentRef.current?.contains(target))) return;
      setOpen(false);
    }
    // Capture phase: price triggers in list rows stop propagation (so the tap doesn't
    // open the order), which would otherwise hide the tap from this listener.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
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
    {/* Opening is driven only by mouse hover / tap below. Radix would also open on
        focus — the card focuses its first control when it opens, which popped this up. */}
    {/* Radix's own open/close is ignored entirely: on phones it reports "pointer left the
        trigger" right after a tap and closed the popup instantly. We close on mouse leave,
        outside tap and Escape ourselves. */}
    <TooltipPrimitive.Root open={open} onOpenChange={() => undefined}>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          data-row-click-ignore=""
          className={`cursor-pointer touch-manipulation rounded-sm text-right underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 outline-none ${className ?? ""}`}
          aria-label={t("orders.totalBreakdown.ariaLabel")}
          ref={triggerRef}
          // Not a tab stop: the card auto-focuses its first focusable element on open,
          // which drew a focus box around the total. Hover / tap still open it.
          tabIndex={-1}
          // Open on mouse movement over the total, but not while the card is still sliding
          // in: a resting cursor ends up over the total and the browser reports a hover.
          onPointerMove={(event) => {
            if (event.pointerType !== "mouse") return;
            if (Date.now() - mountedAt.current < HOVER_GRACE_MS) return;
            cancelClose();
            if (!open) setOpen(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") scheduleClose();
          }}
          onFocus={(event) => event.preventDefault()}
          // Inside list rows / board cards: don't let the tap open the order or start a drag.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            // Touch / keyboard: tap toggles (hover does not exist on phones).
            event.preventDefault();
            event.stopPropagation();
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
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") scheduleClose();
        }}
        onEscapeKeyDown={() => setOpen(false)}
        data-row-click-ignore=""
        data-testid="order-total-breakdown"
        onClick={(event) => event.stopPropagation()}
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
