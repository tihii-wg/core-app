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
import { CLIENT_TOGGLEABLE_COLUMNS, type ClientToggleableColumn } from "./clientColumnVisibility";

type ClientColumnsMenuProps = {
  visibleColumns: ReadonlySet<ClientToggleableColumn>;
  onVisibleColumnsChange: (columns: Set<ClientToggleableColumn>) => void;
};

export function ClientColumnsMenu({ visibleColumns, onVisibleColumnsChange }: ClientColumnsMenuProps) {
  const { t } = useTranslation();

  const labels: Record<ClientToggleableColumn, string> = {
    clientType: t("clients.table.clientType"),
    contact: t("clients.table.contact"),
    orders: t("clients.table.orders"),
    balance: t("clients.table.balance"),
    created: t("clients.table.added"),
  };

  const toggle = (key: ClientToggleableColumn, checked: boolean) => {
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
          {t("clients.columns.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("clients.columns.menuLabel")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CLIENT_TOGGLEABLE_COLUMNS.map((key) => (
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
