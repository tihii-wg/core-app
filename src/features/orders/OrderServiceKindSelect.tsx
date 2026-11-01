import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { OrderServiceKind } from "../../lib/types";
import { useOrderServiceKindSupport } from "./useOrderServiceKindSupport";

const NONE = "__none__";

type OrderServiceKindSelectProps = {
  value: OrderServiceKind | null | undefined;
  onChange: (kind: OrderServiceKind | null) => void;
  /** Used in the accessible name, e.g. the service name. */
  lineName: string;
  disabled?: boolean;
};

/** Optional labor/service marker for an order line. Hidden until `order_services.kind` exists in the database. */
export default function OrderServiceKindSelect({ value, onChange, lineName, disabled }: OrderServiceKindSelectProps) {
  const { t } = useTranslation();
  const supported = useOrderServiceKindSupport();
  if (!supported) return null;

  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : (next as OrderServiceKind))} disabled={disabled}>
      <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("orders.form.lineKindFor", { name: lineName })}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("orders.form.lineKind.none")}</SelectItem>
        <SelectItem value="service">{t("orders.form.lineKind.service")}</SelectItem>
        <SelectItem value="labor">{t("orders.form.lineKind.labor")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
