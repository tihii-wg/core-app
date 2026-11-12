import type { ReactNode } from "react";
import type { Order } from "../../../lib/types";
import { industryUsesMileageWarranty } from "../../industries/industryCapabilities";
import { useIndustryWorkflow } from "../../industries/useIndustryWorkflow";
import type { OrderInlineFieldKind } from "../OrderInlineField";
import { OrderWarrantyIndicator } from "../OrderWarrantyIndicator";
import { useOrdersWarrantyIndicators } from "../useOrdersWarrantyIndicators";

export function customInlineKind(type: string): OrderInlineFieldKind {
  switch (type) {
    case "textarea":
    case "number":
    case "date":
    case "select":
    case "checkbox":
      return type;
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}

export function formatIndustryDateTime(iso: string, locale: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale || "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{value}</dd>
    </div>
  );
}

export function OrderDetailWarrantyUnderNumber({ order }: { order: Order }) {
  const { workflow } = useIndustryWorkflow();
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const { byOrderId } = useOrdersWarrantyIndicators([order], { useMileageWarranty: showWarrantyKm });
  return <OrderWarrantyIndicator model={byOrderId.get(order.id)} className="mt-1 font-normal" />;
}
