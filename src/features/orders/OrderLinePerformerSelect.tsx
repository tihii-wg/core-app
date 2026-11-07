import { useTranslation } from "react-i18next";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { AssignableTechnician } from "./assignableTechnicians";

const NONE_VALUE = "__none__";

type OrderLinePerformerSelectProps = {
  id: string;
  value: string;
  options: AssignableTechnician[];
  disabled?: boolean;
  onChange: (technicianId: string) => void;
};

export default function OrderLinePerformerSelect({
  id,
  value,
  options,
  disabled = false,
  onChange,
}: OrderLinePerformerSelectProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {t("orders.team.performer")}
      </Label>
      <Select
        value={value || NONE_VALUE}
        onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 w-full text-xs sm:max-w-[12rem]">
          <SelectValue placeholder={t("orders.team.notAssigned")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{t("orders.team.notAssigned")}</SelectItem>
          {options.map((technician) => (
            <SelectItem key={technician.id} value={technician.id}>
              {technician.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
