import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetClients } from "../clients/useGetClients";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm, useFieldArray, useWatch } from "react-hook-form";
import type { addNewOrderFormData, CreateMadalProps } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import ClientCombobox from "../clients/ClientCombobox";
import {  useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateOrder } from "./useCreateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { clientEmailRules, clientPhoneRules, clientTypeRules } from "../clients/clientValidation";
import ClientTypeSelect from "../clients/ClientTypeSelect";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssetFields from "./OrderAssetFields";

export default function AddNewOrderForm({ setCreateModalOpen, searchQuery }: CreateMadalProps & { searchQuery: string }) {
  const { t } = useTranslation();
  const { services } = useGetServices();
  const { clients } = useGetClients(searchQuery);
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: createOrder } = useCreateOrder();
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const [clientName, setClientName] = useState("");
  // const clientNameRef = useRef(clientName);

  const activeServices = services?.filter((service) => service.status === "active");
  const techniciansError = employeesError;
  const technicianOptions = assignableTechnicians(employees);

  const {
    control,
    handleSubmit,
    register,
    clearErrors,
    trigger,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<addNewOrderFormData>({
    defaultValues: {
      clientId: "",
      device: "",
      vin: "",
      carNumber: "",
      services: [],
      description: "",
      assignedEmployeeId: "",
      deadline: "",
    },
  });

  const selectedClientId = useWatch({ control, name: "clientId" });
  const typedClientName = clientName.trim();
  const isNewClient = typedClientName !== "" && !selectedClientId && !clients?.some((client) => client.name?.toLowerCase() === typedClientName.toLowerCase());
  const newClientType = useWatch({ control, name: "newClientType" });
  const isNewOrganization = isNewClient && newClientType === "organization";

  const {
    fields: serviceField,
    append: serviceAppend,
    remove: serviceRemove,
  } = useFieldArray({
    control,
    name: "services",
    rules: {
      required: t("orders.validation.serviceRequired"),
      minLength: {
        value: 1,
        message: t("orders.validation.serviceRequired"),
      },
    },
  });

  const totalPrice = serviceField.reduce((total, service) => total + (service.price ?? 0) * service.quantity, 0);

  function handleCancel() {
    setCreateModalOpen(false);
  }

  const onSubmit = async (data: addNewOrderFormData) => {
    try {
      await createOrder({
        clientId: data.clientId || undefined,
        clientName: clientName.trim(),
        clientType: data.newClientType,
        clientTaxId: data.newClientTaxId,
        clientContactPerson: data.newClientContactPerson,
        clientEmail: data.newClientEmail,
        clientPhone: data.newClientPhone,
        device: data.device?.trim() ?? "",
        vin: workflow.orderFields.vin.visible ? data.vin : "",
        carNumber: workflow.orderFields.carNumber.visible ? data.carNumber : "",
        description: data.description,
        services: data.services,
        assignedEmployeeId: data.assignedEmployeeId || undefined,
        deadline: data.deadline,
      });
    } catch {
      return;
    }

    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex w-full min-w-0 max-h-[80vh] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto py-4 pr-2">
        <div className="space-y-1.5">
          <Label htmlFor="client">{isNewOrganization ? t("orders.form.organizationNameLabel") : t("orders.form.clientLabel")}</Label>
          <Controller
            name="clientId"
            control={control}
            rules={{
              validate: (clientId) => clientId.trim() !== "" || clientName.trim() !== "" || t("orders.validation.clientRequired"),
            }}
            render={({ field }) => (
              <ClientCombobox
                inputRef={field.ref}
                errors={!!errors.clientId}
                clients={clients ?? []}
                value={clientName}
                onChange={(value) => {
                  // clientName = value;
                  setClientName(value);
                  field.onChange("");
                  if (isSubmitted) {
                    void trigger("clientId");
                  }
                }}
                onSelect={(client) => {
                  // clientName = client.name;
                  setClientName(client.name);
                  field.onChange(client.id);
                }}
              />
            )}
          />

          {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>}

          {isNewClient && (
            <div className="space-y-4 pt-1.5">
              <div className="space-y-1.5">
                <Label htmlFor="newClientType">{t("clients.form.typeLabel")}</Label>
                <Controller
                  name="newClientType"
                  control={control}
                  defaultValue="individual"
                  shouldUnregister
                  rules={clientTypeRules()}
                  render={({ field }) => <ClientTypeSelect id="newClientType" value={field.value} onChange={field.onChange} />}
                />
                {errors.newClientType && <p className="text-xs text-destructive">{errors.newClientType.message}</p>}
              </div>
              {isNewOrganization && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="newClientTaxId">{t("orders.form.idnoLabel")}</Label>
                    <Input id="newClientTaxId" {...register("newClientTaxId", { shouldUnregister: true })} placeholder={t("common.optional")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newClientContactPerson">{t("orders.form.contactNameLabel")}</Label>
                    <Input id="newClientContactPerson" {...register("newClientContactPerson", { shouldUnregister: true })} placeholder={t("common.optional")} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newClientPhone">{t("clients.form.phoneLabel")}</Label>
                  <Input
                    id="newClientPhone"
                    {...register("newClientPhone", { ...clientPhoneRules(), shouldUnregister: true })}
                    placeholder="+37300000000"
                    className={errors.newClientPhone ? "border-destructive" : ""}
                  />
                  {errors.newClientPhone && <p className="text-xs text-destructive">{errors.newClientPhone.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newClientEmail">{t("clients.form.emailLabel")}</Label>
                  <Input
                    id="newClientEmail"
                    type="email"
                    {...register("newClientEmail", { ...clientEmailRules(), shouldUnregister: true })}
                    placeholder="email@example.com"
                    className={errors.newClientEmail ? "border-destructive" : ""}
                  />
                  {errors.newClientEmail && <p className="text-xs text-destructive">{errors.newClientEmail.message}</p>}
                </div>
              </div>
            </div>
          )}

          {/* <Controller
            name="clientId"
            control={control}
            rules={{
              required: "Client is required",
            }}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className={errors.clientId ? "border-destructive" : ""}>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>} */}
        </div>

        <OrderAssetFields register={register} errors={errors} workflow={workflow} copy={copy} />

        <div className="space-y-1.5">
          <Label htmlFor="service">{t("orders.form.serviceLabel")}</Label>

          <ServiceCombobox
            services={activeServices}
            allowCreate={canCreateServices}
            errors={!!errors.services?.root}
            onSelect={(service) => {
              const alreadyExists = serviceField.some((field) => field.serviceId === service.id);

              if (alreadyExists) return;

              serviceAppend({
                serviceId: service.id,
                serviceName: service.service_name,
                price: service.service_price ?? 0,
                quantity: 1,
              });
              clearErrors("services");
            }}
            onCreate={(serviceName, price) => {
              const alreadyExists = serviceField.some((field) => field.serviceName.toLowerCase() === serviceName.toLowerCase());

              if (alreadyExists) return;

              serviceAppend({
                serviceId: crypto.randomUUID(),
                serviceName,
                price,
                quantity: 1,
              });
              clearErrors("services");
            }}
          />
          {errors.services?.root?.message && <p className="text-xs text-destructive">{errors.services.root.message}</p>}

          {serviceField.length > 0 && (
            <div className="space-y-2">
              {serviceField.map((field, index) => (
                <div key={field.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium">{field.serviceName}</p>
                    <p className="text-[13px] text-muted-foreground tabular-nums">{formatMoney(field.price)}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => serviceRemove(index)}>
                    {t("orders.form.remove")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("orders.form.descriptionLabel")}</Label>
          <Textarea id="description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="assignedEmployeeId">{copy.assignedEmployeeRequiredLabel}</Label>
            <Controller
              name="assignedEmployeeId"
              control={control}
              rules={{
                required: t("orders.validation.assignedEmployeeRequired"),
              }}
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger className={errors.assignedEmployeeId ? "border-destructive" : ""}>
                    <SelectValue placeholder={t("orders.form.selectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {technicianOptions.map((technician) => (
                      <SelectItem key={technician.id} value={technician.id}>
                        {technician.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {techniciansError && (
              <p className="text-xs text-destructive">{techniciansError instanceof Error ? techniciansError.message : t("orders.form.techniciansLoadFailed")}</p>
            )}
            {!techniciansError && !employeesLoading && employees && technicianOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("orders.form.noLinkedTechnicians")}</p>
            )}
            {errors.assignedEmployeeId && <p className="text-xs text-destructive">{errors.assignedEmployeeId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deadline">{copy.deadlineLabel}</Label>
            <div className="relative">
              <Input id="deadline" type="date" {...register("deadline")} />
            </div>
          </div>
        </div>

        <div className=" flex justify-between border-t pt-3">
          <span className="text-lg font-semibold">{t("orders.form.totalPrice")}</span>
          <span>{formatMoney(totalPrice)}</span>
        </div>
      </div>

      <div className="flex w-full  shrink-0 justify-end gap-2 border-t bg-card pt-3">
        <Button variant="outline" type="button" onClick={handleCancel} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("orders.createOrder")}
        </Button>
      </div>
    </form>
  );
}
