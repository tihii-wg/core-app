import { Columns3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import {
  ORDER_COLUMN_FIELD_KEY,
  ORDER_TOGGLEABLE_COLUMNS,
  customColumnKey,
  type OrderBuiltinToggleableColumn,
  type OrderToggleableColumn,
} from "./orderColumnVisibility";

type OrderColumnsMenuProps = {
  visibleColumns: ReadonlySet<OrderToggleableColumn>;
  onVisibleColumnsChange: (columns: Set<OrderToggleableColumn>) => void;
  /** Fallback when field config has no device label. */
  deviceColumnLabel: string;
  /** Merged order field config — drives labels, hidden built-ins, and custom columns. */
  fieldConfig?: OrderFieldConfigItem[];
};

export function OrderColumnsMenu({
  visibleColumns,
  onVisibleColumnsChange,
  deviceColumnLabel,
  fieldConfig = [],
}: OrderColumnsMenuProps) {
  const { t } = useTranslation();
  const byKey = new Map(fieldConfig.map((field) => [field.key, field]));

  const builtinLabels: Record<OrderBuiltinToggleableColumn, string> = {
    client: byKey.get("client")?.label ?? t("orders.table.client"),
    clientType: t("orders.table.clientType"),
    device: byKey.get("device")?.label ?? deviceColumnLabel,
    status: byKey.get("status")?.label ?? t("common.status"),
    payment: t("orders.table.payment"),
    createdBy: t("orders.table.createdBy"),
    employee: byKey.get("assignedEmployee")?.label ?? t("orders.table.assigned"),
    team: byKey.get("team")?.label ?? t("orders.table.team"),
    deadline: byKey.get("deadline")?.label ?? t("orders.table.deadline"),
    total: byKey.get("total")?.label ?? t("common.total"),
  };

  const builtinKeys = ORDER_TOGGLEABLE_COLUMNS.filter((key) => {
    const fieldKey = ORDER_COLUMN_FIELD_KEY[key];
    if (!fieldKey) return true;
    const cfg = byKey.get(fieldKey);
    return cfg ? cfg.visible : true;
  });

  const customFields = fieldConfig.filter((field) => field.isCustom && field.visible);

  const toggle = (key: OrderToggleableColumn, checked: boolean) => {
    const next = new Set(visibleColumns);
    if (checked) next.add(key);
    else next.delete(key);
    onVisibleColumnsChange(next);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-9 shrink-0 self-start sm:self-auto">
          <Columns3 />
          {t("orders.columns.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("orders.columns.menuLabel")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {builtinKeys.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={visibleColumns.has(key)}
            onCheckedChange={(checked) => toggle(key, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            {builtinLabels[key]}
          </DropdownMenuCheckboxItem>
        ))}
        {customFields.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("orders.columns.customFields")}</DropdownMenuLabel>
            {customFields.map((field) => {
              const key = customColumnKey(field.key);
              return (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleColumns.has(key)}
                  onCheckedChange={(checked) => toggle(key, checked === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {field.label}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
