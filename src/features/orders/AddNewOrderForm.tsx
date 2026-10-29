import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { useGetClients } from "../clients/useGetClients";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm, useFieldArray, useWatch } from "react-hook-form";
import type { addNewOrderFormData, CreateMadalProps } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import { catalogServiceToOrderLine, sumOrderServiceLines } from "../services/orderServiceLine";
import { sumOrderMaterialLines } from "../inventory/orderMaterialLine";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import ClientCombobox from "../clients/ClientCombobox";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateOrder } from "./useCreateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { clientEmailRules, clientPhoneRules, clientTypeRules } from "../clients/clientValidation";
import ClientTypeSelect from "../clients/ClientTypeSelect";
import { industryClientCopy } from "../industries/industryWorkflow";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssetFields from "./OrderAssetFields";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import { OrderVehicleFields } from "./OrderVehicleFields";
import { useClearHiddenOrderAssetErrors } from "./useClearHiddenOrderAssetErrors";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";

export default function AddNewOrderForm({
  setCreateModalOpen,
  searchQuery,
  initialClientId = "",
  initialClientName = "",
}: CreateMadalProps & { searchQuery: string; initialClientId?: string; initialClientName?: string }) {
  const { t } = useTranslation();
  const { services } = useGetServices();
  const { clients } = useGetClients(searchQuery);
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const { mutateAsync: createOrder } = useCreateOrder();
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const clientCopy = industryClientCopy(workflow);
  const showVehicles = industrySupportsClientVehicles(workflow);
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const [clientName, setClientName] = useState(initialClientName);
  const submitLockRef = useRef(false);

  const activeServices = services?.filter((service) => service.status === "active");
  const activeInventory = inventoryItems.filter((item) => item.isActive);
  const techniciansError = employeesError;
  const technicianOptions = assignableTechnicians(employees);

  const {
    control,
    handleSubmit,
    register,
    setValue,
    getValues,
    clearErrors,
    trigger,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<addNewOrderFormData>({
    defaultValues: {
      clientId: initialClientId,
      vehicleId: "",
      device: "",
      vin: "",
      carNumber: "",
      services: [],
      materials: [],
      description: "",
      assignedEmployeeId: "",
      deadline: "",
    },
  });

  // Keep typed plate/VIN across industry switches; drop stale required/VIN errors when hidden.
  useClearHiddenOrderAssetErrors(workflow, clearErrors);

  const selectedClientId = useWatch({ control, name: "clientId" });
  /** Client-vehicle industries: order-level make/plate/VIN are obsolete — use the vehicle selector only. */
  const hideDuplicateVehicleAssetFields = showVehicles;
  const typedClientName = clientName.trim();
  const isNewClient = typedClientName !== "" && !selectedClientId && !clients?.some((client) => client.name?.toLowerCase() === typedClientName.toLowerCase());
  const newClientType = useWatch({ control, name: "newClientType" });
  const isNewOrganization = isNewClient && newClientType === "organization";

  useEffect(() => {
    if (hideDuplicateVehicleAssetFields) clearErrors(["device", "carNumber", "vin"]);
  }, [clearErrors, hideDuplicateVehicleAssetFields]);

  const {
    fields: serviceField,
    append: serviceAppend,
    remove: serviceRemove,
  } = useFieldArray({
    control,
    name: "services",
  });

  const {
    fields: materialFields,
    append: materialAppend,
    remove: materialRemove,
  } = useFieldArray({
    control,
    name: "materials",
  });

  const watchedServices = useWatch({ control, name: "services" });
  const watchedMaterials = useWatch({ control, name: "materials" });
  const totalPrice = sumOrderServiceLines(watchedServices) + sumOrderMaterialLines(watchedMaterials);

  function handleCancel() {
    setCreateModalOpen(false);
  }

  const onSubmit = async (data: addNewOrderFormData) => {
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;

    try {
      await createOrder({
        clientId: data.clientId || undefined,
        clientName: clientName.trim(),
        clientType: data.newClientType,
        clientTaxId: data.newClientTaxId,
        clientContactPerson: data.newClientContactPerson,
        clientEmail: data.newClientEmail,
        clientPhone: data.newClientPhone,
        vehicleId: data.vehicleId || null,
        // Vehicle industries store make/plate/VIN on client vehicles, not on the order form.
        device: showVehicles ? "" : (data.device?.trim() ?? ""),
        vin: showVehicles ? "" : workflow.orderFields.vin.visible ? data.vin : "",
        carNumber: showVehicles ? "" : workflow.orderFields.carNumber.visible ? data.carNumber : "",
        description: data.description,
        services: data.services ?? [],
        materials: data.materials,
        assignedEmployeeId: data.assignedEmployeeId || undefined,
        deadline: data.deadline,
      });
    } catch {
      submitLockRef.current = false;
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
            render={({ field }) => (
              <ClientCombobox
                inputRef={field.ref}
                errors={!!errors.clientId}
                clients={clients ?? []}
                value={clientName}
                onChange={(value) => {
                  setClientName(value);
                  field.onChange("");
                  setValue("vehicleId", "");
                  if (isSubmitted) {
                    void trigger("clientId");
                  }
                }}
                onSelect={(client) => {
                  setClientName(client.name);
                  field.onChange(client.id);
                  setValue("vehicleId", "");
                }}
              />
            )}
          />

          {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>}
          <p className="text-xs text-muted-foreground">{t("orders.form.draftHint")}</p>

          {isNewClient && (
            <div className="space-y-4 pt-1.5">
              <div className="space-y-1.5">
                <Label htmlFor="newClientType">{clientCopy.typeLabel}</Label>
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
                    <Input id="newClientTaxId" {...register("newClientTaxId", { shouldUnregister: true })} placeholder={t("clients.form.taxIdPlaceholder")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newClientContactPerson">{t("orders.form.contactNameLabel")}</Label>
                    <Input id="newClientContactPerson" {...register("newClientContactPerson", { shouldUnregister: true })} placeholder={t("clients.form.contactPersonPlaceholder")} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newClientPhone">{t("clients.form.phoneLabel")}</Label>
                  <Input
                    id="newClientPhone"
                    {...register("newClientPhone", { ...clientPhoneRules(), shouldUnregister: true })}
                    placeholder={t("clients.form.phonePlaceholder")}
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
                    placeholder={t("clients.form.emailPlaceholder")}
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

        {showVehicles && selectedClientId ? (
          <OrderVehicleFields control={control} setValue={setValue} clientId={selectedClientId} disabled={isSubmitting} />
        ) : null}

        <OrderAssetFields
          register={register}
          errors={errors}
          workflow={workflow}
          copy={copy}
          preserveHiddenValues
          hideVisibleFields={hideDuplicateVehicleAssetFields}
        />

        <div className="space-y-1.5">
          <Label htmlFor="service">{t("orders.form.serviceLabel")}</Label>

          <ServiceCombobox
            services={activeServices}
            allowCreate={canCreateServices}
            errors={!!errors.services?.root}
            onSelect={(service) => {
              const alreadyExists = serviceField.some((field) => field.serviceId === service.id);

              if (alreadyExists) return;

              serviceAppend(catalogServiceToOrderLine(service));
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
              {serviceField.map((field, index) => {
                const unitPrice = watchedServices?.[index]?.price ?? field.price ?? 0;

                return (
                  <div key={field.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium [overflow-wrap:anywhere]">{field.serviceName}</p>
                      <p className="text-[13px] text-muted-foreground tabular-nums">{formatMoney(unitPrice)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSubmitting}
                      onClick={() => serviceRemove(index)}
                      aria-label={t("orders.form.removeService", { name: field.serviceName })}
                    >
                      {t("orders.form.remove")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <OrderMaterialLinesEditor
          control={control as never}
          fields={materialFields}
          append={materialAppend}
          remove={materialRemove}
          setValue={setValue}
          getValues={getValues}
          trigger={trigger as never}
          inventoryItems={activeInventory}
          disabled={isSubmitting}
          isSubmitted={isSubmitted}
          errors={errors.materials}
        />

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("orders.form.descriptionLabel")}</Label>
          <Textarea id="description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Controller
            name="assignedEmployeeId"
            control={control}
            render={({ field }) => (
              <OrderAssigneeSelect
                id="assignedEmployeeId"
                label={copy.assignedEmployeeLabel}
                value={field.value ?? ""}
                options={technicianOptions}
                disabled={isSubmitting}
                errorMessage={
                  techniciansError instanceof Error ? techniciansError.message : techniciansError ? t("orders.form.techniciansLoadFailed") : null
                }
                emptyHint={
                  !techniciansError && !employeesLoading && employees && technicianOptions.length === 0
                    ? t("orders.form.noLinkedTechnicians")
                    : null
                }
                onChange={field.onChange}
              />
            )}
          />

          <div className="space-y-1.5">
            <Label htmlFor="deadline">{copy.deadlineLabel}</Label>
            <div className="relative">
              <Input id="deadline" type="date" {...register("deadline")} />
            </div>
          </div>
        </div>

        <div className="flex justify-between border-t pt-3">
          <span className="text-lg font-semibold">{t("orders.form.totalPrice")}</span>
          <span className="tabular-nums">{formatMoney(totalPrice)}</span>
        </div>
      </div>

      <div className="flex w-full  shrink-0 justify-end gap-2 border-t bg-card pt-3">
        <Button variant="outline" type="button" onClick={handleCancel} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("orders.form.saveDraft")}
        </Button>
      </div>
    </form>
  );
}
