import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import type { OrderEditField } from "./orderEditFields";

type OrderFieldEditButtonProps = {
  field: OrderEditField;
  /** Human-readable field label interpolated into the aria-label. */
  label: string;
  onEdit: (field: OrderEditField) => void;
};

/** Shared inline pencil used on order detail fields (always visible, 32px tap target). */
export function OrderFieldEditButton({ field, label, onEdit }: OrderFieldEditButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground"
      aria-label={t("orders.detail.editField", { field: label })}
      onClick={() => onEdit(field)}
    >
      <Pencil className="size-3.5" />
    </Button>
  );
}
