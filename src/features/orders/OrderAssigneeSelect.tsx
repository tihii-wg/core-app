import { useTranslation } from "react-i18next";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { AssignableTechnician } from "./assignableTechnicians";
import { ORDER_UNASSIGNED_VALUE, fromAssigneeSelectValue, toAssigneeSelectValue } from "./orderAssignee";

type OrderAssigneeSelectProps = {
  id: string;
  label: string;
  value: string;
  options: AssignableTechnician[];
  disabled?: boolean;
  errorMessage?: string | null;
  emptyHint?: string | null;
  onChange: (assignedEmployeeId: string) => void;
};

export default function OrderAssigneeSelect({
  id,
  label,
  value,
  options,
  disabled = false,
  errorMessage,
  emptyHint,
  onChange,
}: OrderAssigneeSelectProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={toAssigneeSelectValue(value)}
        onValueChange={(next) => onChange(fromAssigneeSelectValue(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("orders.form.selectPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ORDER_UNASSIGNED_VALUE}>{t("orders.detail.unassigned")}</SelectItem>
          {options.map((technician) => (
            <SelectItem key={technician.id} value={technician.id}>
              {technician.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
      {!errorMessage && emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null}
    </div>
  );
}
