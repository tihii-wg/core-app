import { Controller, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import type { ClientFormValues } from "../../lib/types";

const phonePattern = /^\+373\d{8}$/;

type ClientFormFieldsProps = {
  idPrefix: string;
  control: Control<ClientFormValues>;
  register: UseFormRegister<ClientFormValues>;
  errors: FieldErrors<ClientFormValues>;
  disabled?: boolean;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-[#f41f20]">{message}</p>;
}

export default function ClientFormFields({ idPrefix, control, register, errors, disabled }: ClientFormFieldsProps) {
  const clientType = useWatch({ control, name: "clientType" }) ?? "individual";
  const isOrganization = clientType === "organization";
  const nameLabel = isOrganization ? "Organization name *" : "Full name *";
  const nameError = isOrganization ? "Organization name is required" : "Full name is required";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-type`}>Client type *</Label>
        <Controller
          name="clientType"
          control={control}
          rules={{ required: "Client type is required" }}
          render={({ field }) => (
            <Select value={field.value || "individual"} onValueChange={field.onChange} disabled={disabled}>
              <SelectTrigger id={`${idPrefix}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
              </SelectContent>
            </Select>
          )}
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
          placeholder={isOrganization ? "Organization name" : "Full name"}
          className={errors.clientName ? "border-[#f41f20]" : ""}
          disabled={disabled}
        />
        <FieldError message={errors.clientName?.message} />
      </div>

      {isOrganization && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-tax-id`}>Tax ID / IDNO</Label>
            <Input id={`${idPrefix}-tax-id`} {...register("taxId")} placeholder="Optional" disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-contact`}>Contact person</Label>
            <Input id={`${idPrefix}-contact`} {...register("contactPerson")} placeholder="Optional" disabled={disabled} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email *</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            {...register("email", { required: "Email is required" })}
            placeholder="email@example.com"
            className={errors.email ? "border-[#f41f20]" : ""}
            disabled={disabled}
          />
          <FieldError message={errors.email?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-phone`}>Phone *</Label>
          <Input
            id={`${idPrefix}-phone`}
            {...register("phone", {
              required: "Phone is required",
              pattern: {
                value: phonePattern,
                message: "Phone must be in format +37300000000",
              },
            })}
            placeholder="+37300000000"
            className={errors.phone ? "border-[#f41f20]" : ""}
            disabled={disabled}
          />
          <FieldError message={errors.phone?.message} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-address`}>Address</Label>
        <Input id={`${idPrefix}-address`} {...register("address")} placeholder="Street address, city, state" disabled={disabled} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Textarea id={`${idPrefix}-notes`} {...register("notes")} placeholder="Additional notes about this client..." rows={3} disabled={disabled} />
      </div>
    </div>
  );
}
