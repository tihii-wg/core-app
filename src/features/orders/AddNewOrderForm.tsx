import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { useGetClients } from "../clients/useGetClients";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm, useFieldArray, useWatch } from "react-hook-form";
import type { addNewOrderFormData, CreateMadalProps, Vehicle } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import { catalogServiceToOrderLine } from "../services/orderServiceLine";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import ClientCombobox from "../clients/ClientCombobox";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateOrder } from "./useCreateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { clientPhoneRules, clientTypeRules } from "../clients/clientValidation";
import ClientTypeSelect from "../clients/ClientTypeSelect";
import { industryClientCopy } from "../industries/industryWorkflow";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { clientVehiclesQueryKey, useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssetFields from "./OrderAssetFields";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import { OrderVehicleFields } from "./OrderVehicleFields";
import { buildOrderMileageSnapshot, persistOrderVehicleMileage } from "./orderVehicleMileage";
import { useClearHiddenOrderAssetErrors } from "./useClearHiddenOrderAssetErrors";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";
import OrderServiceKindSelect from "./OrderServiceKindSelect";
import { useGetClientDiscounts } from "../clients/useGetClientExtensions";
import OrderTotalsSummary from "./OrderTotalsSummary";
import { previewOrderMoney } from "./orderMoneyPreview";
import { useDebounce } from "../../hooks/useDebounce";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { defaultsForKind } from "./warranty";

export default function AddNewOrderForm({
  setCreateModalOpen,
  searchQuery,
  initialClientId = "",
  initialClientName = "",
}: CreateMadalProps & { searchQuery: string; initialClientId?: string; initialClientName?: string }) {
  const { t } = useTranslation();
  const { services } = useGetServices();
  const [clientName, setClientName] = useState(initialClientName);
  // Explicit create mode — typing a name that already exists must not auto-reuse that client.
  const [createNewClient, setCreateNewClient] = useState(false);
  const debouncedClientSearch = useDebounce(clientName.trim(), 250);
  const clientListSearch = debouncedClientSearch || searchQuery;
  const { clients } = useGetClients(clientListSearch);
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const { mutateAsync: createOrder } = useCreateOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const { formatMoney } = useWorkspaceMoney();
  const { data: workspace } = useGetWorkspace();
  const warrantyDefaults = {
    serviceDurationMonths: workspace?.warrantyServiceMonths ?? null,
    serviceMileageLimit: workspace?.warrantyServiceKm ?? null,
    partsDurationMonths: workspace?.warrantyPartsMonths ?? null,
    partsMileageLimit: workspace?.warrantyPartsKm ?? null,
  };
  const { workflow, copy } = useIndustryWorkflow();
  const clientCopy = industryClientCopy(workflow);
  const showVehicles = industrySupportsClientVehicles(workflow);
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
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
      currentMileage: "",
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
  const { vehicles: clientVehicles } = useGetClientVehicles(showVehicles ? selectedClientId || null : null);
  /** Client-vehicle industries: order-level make/plate/VIN are obsolete — use the vehicle selector only. */
  const hideDuplicateVehicleAssetFields = showVehicles;
  const typedClientName = clientName.trim();
  const isNewClient = createNewClient && typedClientName !== "" && !selectedClientId;
  const newClientType = useWatch({ control, name: "newClientType" });
  const isNewOrganization = isNewClient && newClientType === "organization";
  const selectedClient = useMemo(
    () => (selectedClientId ? (clients ?? []).find((client) => client.id === selectedClientId) : undefined),
    [clients, selectedClientId],
  );

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
  // Same math createOrder persists: the client's service_order / product_order percent is stamped onto the lines.
  const { rows: clientDiscounts } = useGetClientDiscounts(selectedClientId || null, Boolean(selectedClientId));
  const orderMoney = previewOrderMoney(watchedServices, watchedMaterials, clientDiscounts);

  function handleCancel() {
    setCreateModalOpen(false);
  }

  const onSubmit = async (data: addNewOrderFormData) => {
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;

    try {
      // Typed name without an explicit select or create must not silently reuse/create by name.
      if (typedClientName && !data.clientId && !createNewClient) {
        toast.error(t("clients.combobox.selectOrCreate"));
        submitLockRef.current = false;
        return;
      }

      const selectedVehicleId = data.vehicleId?.trim() || "";
      if (showVehicles && selectedVehicleId) {
        try {
          // Prefer the live hook list; fall back to cache for a vehicle just created inline
          // before the parent form re-renders from query invalidation.
          const cachedVehicles =
            queryClient.getQueryData<Vehicle[]>(clientVehiclesQueryKey(workspaceId, selectedClientId)) ?? [];
          const selectedVehicle =
            clientVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ??
            cachedVehicles.find((vehicle) => vehicle.id === selectedVehicleId);
          const hasVisitMileage = Boolean(data.currentMileage?.trim());
          if (!selectedVehicle) {
            // Empty mileage needs no vehicle row write — keep the order create unblocked after inline create.
            if (hasVisitMileage) throw new Error(t("vehicles.errors.invalidSelection"));
          } else {
            guardWrite();
            // Persist visit mileage before creating the order so a failed mileage write never reports order success.
            await persistOrderVehicleMileage({
              workspaceId,
              clientId: selectedVehicle.clientId,
              vehicle: selectedVehicle,
              formMileage: data.currentMileage,
              queryClient,
            });
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
          throw error;
        }
      }

      const selectedVehicleForSnapshot =
        showVehicles && selectedVehicleId
          ? clientVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ??
            (queryClient.getQueryData<Vehicle[]>(clientVehiclesQueryKey(workspaceId, selectedClientId)) ?? []).find(
              (vehicle) => vehicle.id === selectedVehicleId,
            )
          : undefined;
      const mileageSnapshot = buildOrderMileageSnapshot(data.currentMileage, selectedVehicleForSnapshot);

      await createOrder({
        clientId: data.clientId || undefined,
        // Only send a create-name when the user explicitly chose “Create new client”.
        clientName: data.clientId ? clientName.trim() : createNewClient ? clientName.trim() : "",
        clientType: createNewClient ? data.newClientType : undefined,
        clientTaxId: createNewClient ? data.newClientTaxId : undefined,
        clientContactPerson: createNewClient ? data.newClientContactPerson : undefined,
        clientPhone: createNewClient ? data.newClientPhone : undefined,
        vehicleId: data.vehicleId || null,
        // Vehicle industries: OrderVehicleFields snapshots device/plate/VIN from the selected vehicle.
        device: data.device?.trim() ?? "",
        vin: showVehicles ? (data.vin?.trim() ?? "") : workflow.orderFields.vin.visible ? data.vin : "",
        carNumber: showVehicles
          ? (data.carNumber?.trim() ?? "")
          : workflow.orderFields.carNumber.visible
            ? data.carNumber
            : "",
        ...(mileageSnapshot ?? {}),
        description: data.description,
        services: data.services ?? [],
        materials: data.materials,
        assignedEmployeeId: data.assignedEmployeeId || undefined,
        deadline: data.deadline,
      });
    } catch {
      // useCreateOrder already toasts API failures.
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
                  setCreateNewClient(false);
                  field.onChange("");
                  setValue("vehicleId", "");
                  if (isSubmitted) {
                    void trigger("clientId");
                  }
                }}
                onSelect={(client) => {
                  setCreateNewClient(false);
                  setClientName(client.name);
                  field.onChange(client.id);
                  setValue("vehicleId", "");
                }}
                onCreateRequest={(name) => {
                  setCreateNewClient(true);
                  setClientName(name);
                  field.onChange("");
                  setValue("vehicleId", "");
                }}
              />
            )}
          />

          {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>}
          {selectedClientId && !isNewClient ? (
            <p className="text-xs text-muted-foreground">
              {t("clients.combobox.selectedHint", {
                name: selectedClient?.name || clientName,
                phone: selectedClient?.phone?.trim() || t("clients.combobox.noPhone"),
              })}
            </p>
          ) : null}
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
          <OrderVehicleFields
            control={control}
            setValue={setValue}
            register={register}
            errors={errors}
            clientId={selectedClientId}
            disabled={isSubmitting}
            mileageMode="empty"
          />
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

              const warranty = defaultsForKind(warrantyDefaults, "service");
              serviceAppend({
                ...catalogServiceToOrderLine(service),
                warrantyMonths: warranty.durationMonths,
                warrantyKm: warranty.mileageLimit,
              });
              clearErrors("services");
            }}
            onCreate={(serviceName, price) => {
              const alreadyExists = serviceField.some((field) => field.serviceName.toLowerCase() === serviceName.toLowerCase());

              if (alreadyExists) return;

              const warranty = defaultsForKind(warrantyDefaults, "service");
              serviceAppend({
                serviceId: crypto.randomUUID(),
                serviceName,
                price,
                quantity: 1,
                warrantyMonths: warranty.durationMonths,
                warrantyKm: warranty.mileageLimit,
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
                  <div key={field.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium [overflow-wrap:anywhere]">{field.serviceName}</p>
                        <p className="text-[13px] text-muted-foreground tabular-nums">{formatMoney(unitPrice)}</p>
                      </div>
                      <OrderServiceKindSelect
                        value={watchedServices?.[index]?.kind}
                        lineName={field.serviceName}
                        disabled={isSubmitting}
                        onChange={(kind) => setValue(`services.${index}.kind`, kind, { shouldDirty: true })}
                      />
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
                    <OrderLineWarrantyFields
                      idPrefix={`create-service-${index}`}
                      months={watchedServices?.[index]?.warrantyMonths}
                      days={watchedServices?.[index]?.warrantyDays}
                      km={watchedServices?.[index]?.warrantyKm}
                      disabled={isSubmitting}
                      onChange={({ warrantyMonths, warrantyDays, warrantyKm }) => {
                        setValue(`services.${index}.warrantyMonths`, warrantyMonths, { shouldDirty: true });
                        setValue(`services.${index}.warrantyDays`, warrantyDays, { shouldDirty: true });
                        setValue(`services.${index}.warrantyKm`, warrantyKm, { shouldDirty: true });
                      }}
                    />
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
          warrantyDefaults={warrantyDefaults}
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

        <OrderTotalsSummary
          money={orderMoney}
          formatMoney={formatMoney}
          clientDiscountPercents={{ services: orderMoney.servicePercent, products: orderMoney.productPercent }}
        />
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
