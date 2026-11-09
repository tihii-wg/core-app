import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { AssignableTechnician } from "./assignableTechnicians";
import type { OrderTeamMemberInput, OrderTeamRole } from "./orderTeam";

type OrderTeamSelectProps = {
  id: string;
  label: string;
  value: Array<{ employeeId: string; role: OrderTeamRole }>;
  options: AssignableTechnician[];
  disabled?: boolean;
  onChange: (next: OrderTeamMemberInput[]) => void;
  /** Optional control rendered on the label row (e.g. detail-panel field pencil). */
  labelAction?: ReactNode;
};

export default function OrderTeamSelect({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
  labelAction,
}: OrderTeamSelectProps) {
  const { t } = useTranslation();

  const nameById = new Map(options.map((option) => [option.id, option.name]));
  const selectedIds = new Set(value.map((member) => member.employeeId));
  const available = options.filter((option) => !selectedIds.has(option.id));

  const toggleRole = (employeeId: string) => {
    onChange(
      value.map((member) =>
        member.employeeId === employeeId ? { ...member, role: member.role === "lead" ? "helper" : "lead" } : member,
      ),
    );
  };

  const remove = (employeeId: string) => {
    onChange(value.filter((member) => member.employeeId !== employeeId));
  };

  const add = (employeeId: string) => {
    if (!employeeId || selectedIds.has(employeeId)) return;
    onChange([...value, { employeeId, role: "helper" }]);
  };

  return (
    <div className="space-y-1.5" data-edit-field="team">
      <div className="flex min-w-0 items-center justify-between gap-1">
        <Label htmlFor={id} className="min-w-0">
          {label}
        </Label>
        {labelAction}
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((member) => {
            const name = nameById.get(member.employeeId) ?? member.employeeId;
            const roleLabel = member.role === "lead" ? t("orders.team.lead") : t("orders.team.helper");
            return (
              <li
                key={member.employeeId}
                className="flex items-center gap-1 rounded-md border border-border bg-muted py-0.5 pl-2 pr-0.5 text-xs"
              >
                <span className="max-w-[10rem] truncate font-medium">{name}</span>
                <Button
                  type="button"
                  variant={member.role === "lead" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={disabled}
                  onClick={() => toggleRole(member.employeeId)}
                >
                  {roleLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  disabled={disabled}
                  aria-label={`${t("common.delete")}: ${name}`}
                  onClick={() => remove(member.employeeId)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Select value="" onValueChange={add} disabled={disabled || available.length === 0}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("orders.team.addEmployee")} />
        </SelectTrigger>
        <SelectContent>
          {available.map((technician) => (
            <SelectItem key={technician.id} value={technician.id}>
              {technician.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
