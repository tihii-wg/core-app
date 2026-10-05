import { Controller, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import type { ClientFormValues } from "../../lib/types";
import { clientEmailRules, clientPhoneRules, clientTypeRules } from "./clientValidation";
import ClientTypeSelect from "./ClientTypeSelect";

type ClientFormFieldsProps = {
  idPrefix: string;
  control: Control<ClientFormValues>;
  register: UseFormRegister<ClientFormValues>;
  errors: FieldErrors<ClientFormValues>;
  disabled?: boolean;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function ClientFormFields({ idPrefix, control, register, errors, disabled }: ClientFormFieldsProps) {
  const { t } = useTranslation();
  const clientType = useWatch({ control, name: "clientType" }) ?? "individual";
  const isOrganization = clientType === "organization";
  const nameLabel = isOrganization ? t("clients.form.organizationNameLabel") : t("clients.form.fullNameLabel");
  const nameError = isOrganization ? t("clients.validation.organizationNameRequired") : t("clients.validation.fullNameRequired");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-type`}>{t("clients.form.typeLabel")}</Label>
        <Controller
          name="clientType"
          control={control}
          rules={clientTypeRules()}
          render={({ field }) => <ClientTypeSelect id={`${idPrefix}-type`} value={field.value} onChange={field.onChange} disabled={disabled} />}
        />
        <FieldError message={errors.clientType?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>{nameLabel}</Label>
        <Input
          id={`${idPrefix}-name`}
          {...register("clientName", {
            required: nameError,
            validate: (value) => value.trim().length > 0 || nameError,
          })}
          placeholder={isOrganization ? t("clients.form.organizationNamePlaceholder") : t("clients.form.fullNamePlaceholder")}
          className={errors.clientName ? "border-destructive" : ""}
          disabled={disabled}
        />
        <FieldError message={errors.clientName?.message} />
      </div>

      {isOrganization && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-tax-id`}>{t("clients.form.taxIdLabel")}</Label>
            <Input id={`${idPrefix}-tax-id`} {...register("taxId")} placeholder={t("common.optional")} disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-contact`}>{t("clients.form.contactPersonLabel")}</Label>
            <Input id={`${idPrefix}-contact`} {...register("contactPerson")} placeholder={t("common.optional")} disabled={disabled} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>{t("clients.form.emailLabel")}</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            {...register("email", clientEmailRules())}
            placeholder="email@example.com"
            className={errors.email ? "border-destructive" : ""}
            disabled={disabled}
          />
          <FieldError message={errors.email?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-phone`}>{t("clients.form.phoneLabel")}</Label>
          <Input
            id={`${idPrefix}-phone`}
            {...register("phone", clientPhoneRules())}
            placeholder="+37300000000"
            className={errors.phone ? "border-destructive" : ""}
            disabled={disabled}
          />
          <FieldError message={errors.phone?.message} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-address`}>{t("clients.form.addressLabel")}</Label>
        <Input id={`${idPrefix}-address`} {...register("address")} placeholder={t("clients.form.addressPlaceholder")} disabled={disabled} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>{t("clients.form.notesLabel")}</Label>
        <Textarea id={`${idPrefix}-notes`} {...register("notes")} placeholder={t("clients.form.notesPlaceholder")} rows={3} disabled={disabled} />
      </div>
    </div>
  );
}
