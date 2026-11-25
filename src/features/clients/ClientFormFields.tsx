import { Fragment, type ReactNode } from "react";
import { useFormFieldLayout } from "../formFields/useFormFields";
import { Controller, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import type { ClientFormValues } from "../../lib/types";
import { industryClientCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { clientPhoneRules, clientTypeRules } from "./clientValidation";
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
  const { workflow } = useIndustryWorkflow();
  const copy = industryClientCopy(workflow);
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const showMiddleName = Boolean(workspace?.showClientMiddleName);
  const clientType = useWatch({ control, name: "clientType" }) ?? "individual";
  const isOrganization = clientType === "organization";
  const nameLabel = isOrganization ? t("clients.form.organizationNameLabel") : t("clients.form.fullNameLabel");
  const nameError = isOrganization ? t("clients.validation.organizationNameRequired") : t("clients.validation.fullNameRequired");

  const layout = useFormFieldLayout("client");
  const blocks: Array<{ key: string; node: ReactNode }> = [
    {
      key: "clientType",
      node: (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-type`}>{layout.label("clientType", copy.typeLabel)}</Label>
          <Controller
            name="clientType"
            control={control}
            rules={clientTypeRules()}
            render={({ field }) => <ClientTypeSelect id={`${idPrefix}-type`} value={field.value} onChange={field.onChange} disabled={disabled} />}
          />
          <FieldError message={errors.clientType?.message} />
        </div>
      ),
    },
    {
      key: "clientName",
      node: (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>{layout.label("clientName", nameLabel)}</Label>
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
      ),
    },
    {
      key: "middleName",
      node:
        showMiddleName && !isOrganization ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-middle-name`}>{layout.label("middleName", t("clients.form.middleNameLabel"))}</Label>
            <Input id={`${idPrefix}-middle-name`} {...register("middleName")} placeholder={t("clients.form.middleNamePlaceholder")} disabled={disabled} />
          </div>
        ) : null,
    },
    {
      key: "taxId",
      node: isOrganization ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-tax-id`}>{layout.label("taxId", t("clients.form.taxIdLabel"))}</Label>
          <Input id={`${idPrefix}-tax-id`} {...register("taxId")} placeholder={t("clients.form.taxIdPlaceholder")} disabled={disabled} />
        </div>
      ) : null,
    },
    {
      key: "contactPerson",
      node: isOrganization ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-contact`}>{layout.label("contactPerson", t("clients.form.contactPersonLabel"))}</Label>
          <Input id={`${idPrefix}-contact`} {...register("contactPerson")} placeholder={t("clients.form.contactPersonPlaceholder")} disabled={disabled} />
        </div>
      ) : null,
    },
    {
      key: "phone",
      node: (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-phone`}>{layout.label("phone", t("clients.form.phoneLabel"))}</Label>
          <Input
            id={`${idPrefix}-phone`}
            {...register("phone", clientPhoneRules())}
            placeholder={t("clients.form.phonePlaceholder")}
            className={errors.phone ? "border-destructive" : ""}
            disabled={disabled}
          />
          <FieldError message={errors.phone?.message} />
        </div>
      ),
    },
    {
      key: "address",
      node: (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-address`}>{layout.label("address", copy.addressLabel)}</Label>
          <Input id={`${idPrefix}-address`} {...register("address")} placeholder={copy.addressPlaceholder} disabled={disabled} />
        </div>
      ),
    },
    {
      key: "notes",
      node: (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>{layout.label("notes", t("clients.form.notesLabel"))}</Label>
          <Textarea id={`${idPrefix}-notes`} {...register("notes")} placeholder={copy.notesPlaceholder} rows={3} disabled={disabled} />
        </div>
      ),
    },
    {
      key: "consents",
      node: (
        <div className="space-y-3 rounded-lg border border-border px-3 py-3">
          <Controller
            name="phoneNotificationsConsent"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${idPrefix}-phone-consent`} className="text-sm font-normal">
                  {t("clients.form.phoneConsentLabel")}
                </Label>
                <Switch id={`${idPrefix}-phone-consent`} checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />
              </div>
            )}
          />
          <Controller
            name="emailNotificationsConsent"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${idPrefix}-email-consent`} className="text-sm font-normal">
                  {t("clients.form.emailConsentLabel")}
                </Label>
                <Switch id={`${idPrefix}-email-consent`} checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />
              </div>
            )}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {layout.arrange(blocks).map((block) => (
        <Fragment key={block.key}>{block.node}</Fragment>
      ))}
    </div>
  );
}
