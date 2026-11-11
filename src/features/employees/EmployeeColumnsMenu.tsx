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
import { EMPLOYEE_TOGGLEABLE_COLUMNS, type EmployeeToggleableColumn } from "./employeeColumnVisibility";

type EmployeeColumnsMenuProps = {
  visibleColumns: ReadonlySet<EmployeeToggleableColumn>;
  onVisibleColumnsChange: (columns: Set<EmployeeToggleableColumn>) => void;
};

export function EmployeeColumnsMenu({ visibleColumns, onVisibleColumnsChange }: EmployeeColumnsMenuProps) {
  const { t } = useTranslation();

  const labels: Record<EmployeeToggleableColumn, string> = {
    status: t("common.status"),
    role: t("employees.columns.role"),
    open: t("employees.columns.openOrders"),
    overdue: t("employees.columns.overdueOrders"),
    closed: t("employees.columns.closedOrders"),
  };

  const toggle = (key: EmployeeToggleableColumn, checked: boolean) => {
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
          {t("employees.columns.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("employees.columns.menuLabel")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EMPLOYEE_TOGGLEABLE_COLUMNS.map((key) => (
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
