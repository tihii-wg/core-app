import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { ClientType } from "../../lib/types";

type ClientTypeSelectProps = {
  id: string;
  value: ClientType | undefined;
  onChange: (value: ClientType) => void;
  disabled?: boolean;
};

export default function ClientTypeSelect({ id, value, onChange, disabled }: ClientTypeSelectProps) {
  const { t } = useTranslation();

  return (
    <Select value={value || "individual"} onValueChange={(next) => onChange(next as ClientType)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="individual">{t("clients.types.individual")}</SelectItem>
        <SelectItem value="organization">{t("clients.types.organization")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
