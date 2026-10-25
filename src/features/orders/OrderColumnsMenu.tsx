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
import type { OrderToggleableColumn } from "./orderColumnVisibility";
import { ORDER_TOGGLEABLE_COLUMNS } from "./orderColumnVisibility";

type OrderColumnsMenuProps = {
  visibleColumns: ReadonlySet<OrderToggleableColumn>;
  onVisibleColumnsChange: (columns: Set<OrderToggleableColumn>) => void;
  deviceColumnLabel: string;
};

export function OrderColumnsMenu({ visibleColumns, onVisibleColumnsChange, deviceColumnLabel }: OrderColumnsMenuProps) {
  const { t } = useTranslation();

  const labels: Record<OrderToggleableColumn, string> = {
    client: t("orders.table.client"),
    clientType: t("orders.table.clientType"),
    device: deviceColumnLabel,
    status: t("common.status"),
    createdBy: t("orders.table.createdBy"),
    employee: t("orders.table.assigned"),
    deadline: t("orders.table.deadline"),
    total: t("common.total"),
  };

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
        {ORDER_TOGGLEABLE_COLUMNS.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={visibleColumns.has(key)}
            onCheckedChange={(checked) => toggle(key, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            {labels[key]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
