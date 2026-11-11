import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { useGetClients } from "../clients/useGetClients";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm, useFieldArray, useWatch } from "react-hook-form";
import type { addNewOrderFormData, Client, CreateMadalProps, Vehicle } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import { catalogServiceToOrderLine } from "../services/orderServiceLine";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { AddClientDialog } from "../clients/AddClientDialog";
import ClientCombobox from "../clients/ClientCombobox";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateOrder } from "./useCreateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceVatRate } from "../finance/useWorkspaceVatRate";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { industrySupportsClientVehicles, industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryProfile } from "../industries/industryProfile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { clientVehiclesQueryKey, useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useSearchVehiclesByRegistration } from "../vehicles/useSearchVehiclesByRegistration";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssetFields from "./OrderAssetFields";
import OrderIndustryFields from "./OrderIndustryFields";
import { OrderCustomFields, collectCustomFieldPayload, validateRequiredCustomFields, type OrderCustomFieldValues } from "./OrderCustomFields";
import { fieldConfigMap, useOrderFieldConfig, useSaveOrderCustomFieldValues } from "./useOrderFieldConfig";
import {
  emptyOrderIndustryFormFields,
  isInstallationBeforeMeasurement,
  orderIndustryFieldsToApi,
} from "./industryOrderFieldHelpers";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import OrderTeamSelect from "./OrderTeamSelect";
import OrderLinePerformerSelect from "./OrderLinePerformerSelect";
import { mergeOrderTeam } from "./orderTeam";
import { OrderVehicleFields } from "./OrderVehicleFields";
import { buildOrderMileageSnapshot, persistOrderVehicleMileage } from "./orderVehicleMileage";
import { useClearHiddenOrderAssetErrors } from "./useClearHiddenOrderAssetErrors";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";
import OrderLinePriceField from "./OrderLinePriceField";
import OrderServiceKindSelect from "./OrderServiceKindSelect";
import { useGetClientDiscounts } from "../clients/useGetClientExtensions";
import OrderTotalsSummary from "./OrderTotalsSummary";
import { previewOrderMoney } from "./orderMoneyPreview";
import { useDebounce } from "../../hooks/useDebounce";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { defaultsForKind } from "./warranty";
import { catalogWarrantyKmToOrderUnit } from "./catalogWarranty";
import { useOrderMileageUnitSync } from "./useOrderMileageUnit";

export default function AddNewOrderForm({
  setCreateModalOpen,
  searchQuery,
  initialClientId = "",
  initialClientName = "",
  initialVehicleId = "",
}: CreateMadalProps & {
  searchQuery: string;
  initialClientId?: string;
  initialClientName?: string;
  /** Prefill the vehicle selector; must belong to `initialClientId` when both are set. */
  initialVehicleId?: string;
}) {
  const { t } = useTranslation();
  const { services } = useGetServices();
  const [clientName, setClientName] = useState(initialClientName);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientDialogInitialName, setClientDialogInitialName] = useState("");
  /** Clients just created in this session — shown immediately before the list refetch lands. */
  const [extraClients, setExtraClients] = useState<Client[]>([]);
  /** Restore a preselected / just-created vehicle once the client vehicle list includes it. */
  const pendingVehicleIdRef = useRef<string | null>(initialVehicleId.trim() || null);
  const clientInputRef = useRef<HTMLInputElement | null>(null);
  const debouncedClientSearch = useDebounce(clientName.trim(), 250);
  const clientListSearch = debouncedClientSearch || searchQuery;
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const { mutateAsync: createOrder } = useCreateOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const { formatMoney } = useWorkspaceMoney();
  const { rate: workspaceVatRate } = useWorkspaceVatRate();
  const { data: workspace } = useGetWorkspace();
  const warrantyDefaults = {
    serviceDurationMonths: workspace?.warrantyServiceMonths ?? null,
    serviceMileageLimit: workspace?.warrantyServiceKm ?? null,
    partsDurationMonths: workspace?.warrantyPartsMonths ?? null,
    partsMileageLimit: workspace?.warrantyPartsKm ?? null,
  };
  const { workflow, copy, profile, industrySlug } = useIndustryWorkflow();
  const showVehicles = industrySupportsClientVehicles(workflow);
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  // When plate hits are shown separately, skip getClients' plate→client expansion to avoid
  // client-only rows that would clear the vehicle on select.
  const { clients } = useGetClients(clientListSearch, "all", { includeVehicleMatches: !showVehicles });
  const plateSearchEnabled = showVehicles && debouncedClientSearch.length >= 2;
  const {
    hits: vehicleRegistrationHits,
    isLoading: vehicleRegistrationLoading,
    isError: vehicleRegistrationError,
  } = useSearchVehiclesByRegistration(debouncedClientSearch, { enabled: plateSearchEnabled });
  const clientsForCombobox = useMemo(() => {
    const base = clients ?? [];
    const extras = extraClients.filter((extra) => !base.some((client) => client.id === extra.id));
    return extras.length > 0 ? [...extras, ...base] : base;
  }, [clients, extraClients]);
  const industryBlocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const submitLockRef = useRef(false);
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const orderFieldMap = useMemo(() => fieldConfigMap(orderFieldConfig), [orderFieldConfig]);
  const saveCustomValues = useSaveOrderCustomFieldValues();
  const [customValues, setCustomValues] = useState<OrderCustomFieldValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});

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
      vehicleId: initialVehicleId,
      device: "",
      vin: "",
      carNumber: "",
      ...emptyOrderIndustryFormFields(),
      currentMileage: "",
      services: [],
      materials: [],
      description: "",
      assignedEmployeeId: "",
      team: [],
      deadline: "",
    },
  });

  const descriptionCfg = orderFieldMap.get("description");
  const assignedCfg = orderFieldMap.get("assignedEmployee");
  const teamCfg = orderFieldMap.get("team");
  const deadlineCfg = orderFieldMap.get("deadline");
  const materialsCfg = orderFieldMap.get("materials");
  const clientCfg = orderFieldMap.get("client");
  const servicesCfg = orderFieldMap.get("services");

  /** Adds a line performer to the team chips as a helper when not already present. */
  function addPerformerToTeam(employeeId: string | null | undefined) {
    const id = employeeId?.trim();
    if (!id) return;
    const current = getValues("team") ?? [];
    if (current.some((member) => member.employeeId === id)) return;
    setValue("team", mergeOrderTeam({ team: current, lineTechnicianIds: [id] }), { shouldDirty: true });
  }

  // Keep typed plate/VIN across industry switches; drop stale required/VIN errors when hidden.
  useClearHiddenOrderAssetErrors(workflow, clearErrors);

  const selectedClientId = useWatch({ control, name: "clientId" });
  const selectedVehicleId = useWatch({ control, name: "vehicleId" });
  const { vehicles: clientVehicles } = useGetClientVehicles(showVehicles ? selectedClientId || null : null);
  /** Client-vehicle industries: order-level make/plate/VIN are obsolete — use the vehicle selector only. */
  const hideDuplicateVehicleAssetFields = showVehicles;
  const typedClientName = clientName.trim();
  const selectedClient = useMemo(
    () => (selectedClientId ? clientsForCombobox.find((client) => client.id === selectedClientId) : undefined),
    [clientsForCombobox, selectedClientId],
  );
  const selectedVehicle = useMemo(
    () => (selectedVehicleId ? clientVehicles.find((vehicle) => vehicle.id === selectedVehicleId) : undefined),
    [clientVehicles, selectedVehicleId],
  );
  const mileageUnitHandlers = useMemo(
    () => ({
      getServices: () => getValues("services") ?? [],
      getMaterials: () => getValues("materials") ?? [],
      setServiceWarrantyKm: (index: number, warrantyKm: number | null) =>
        setValue(`services.${index}.warrantyKm`, warrantyKm, { shouldDirty: true }),
      setMaterialWarrantyKm: (index: number, warrantyKm: number | null) =>
        setValue(`materials.${index}.warrantyKm`, warrantyKm, { shouldDirty: true }),
    }),
    [getValues, setValue],
  );
  const orderMileageUnit = useOrderMileageUnitSync({
    vehicleUnit: selectedVehicle?.mileageUnit,
    handlers: mileageUnitHandlers,
    enabled: showWarrantyKm,
  });

  useEffect(() => {
    if (hideDuplicateVehicleAssetFields) clearErrors(["device", "carNumber", "vin"]);
  }, [clearErrors, hideDuplicateVehicleAssetFields]);

  useEffect(() => {
    const pending = pendingVehicleIdRef.current;
    if (!pending || !selectedClientId) return;
    if (!clientVehicles.some((vehicle) => vehicle.id === pending)) return;
    setValue("vehicleId", pending);
    pendingVehicleIdRef.current = null;
  }, [clientVehicles, selectedClientId, setValue]);

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
      // Typed name without an explicit select must not silently reuse/create by name.
      if (typedClientName && !data.clientId) {
        toast.error(t("clients.combobox.selectOrCreate"));
        submitLockRef.current = false;
        return;
      }

      const selectedVehicleId = data.vehicleId?.trim() || "";
      if (showVehicles && selectedVehicleId) {
        try {
          // Prefer the live hook list; fall back to cache for a vehicle just created
          // before the parent form re-renders from query invalidation.
          const cachedVehicles =
            queryClient.getQueryData<Vehicle[]>(clientVehiclesQueryKey(workspaceId, selectedClientId)) ?? [];
          const selectedVehicle =
            clientVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ??
            cachedVehicles.find((vehicle) => vehicle.id === selectedVehicleId);
          const hasVisitMileage = Boolean(data.currentMileage?.trim());
          if (!selectedVehicle) {
            // Empty mileage needs no vehicle row write — keep the order create unblocked after create.
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
      const industryFields = orderIndustryFieldsToApi(data);
      if (isInstallationBeforeMeasurement(industryFields.measurementAt, industryFields.installationAt)) {
        toast.error(t("orders.validation.installationBeforeMeasurement"));
        submitLockRef.current = false;
        return;
      }

      const requiredErrors = validateRequiredCustomFields(
        orderFieldConfig,
        customValues,
        t("settings.orderFields.validation.required"),
      );
      if (Object.keys(requiredErrors).length > 0) {
        setCustomErrors(requiredErrors);
        submitLockRef.current = false;
        return;
      }

      const created = await createOrder({
        clientId: data.clientId || undefined,
        clientName: data.clientId ? clientName.trim() : "",
        vehicleId: data.vehicleId || null,
        // Vehicle industries: OrderVehicleFields snapshots device/plate/VIN from the selected vehicle.
        device: data.device?.trim() ?? "",
        vin: showVehicles ? (data.vin?.trim() ?? "") : workflow.orderFields.vin.visible ? data.vin : "",
        carNumber: showVehicles
          ? (data.carNumber?.trim() ?? "")
          : workflow.orderFields.carNumber.visible
            ? data.carNumber
            : "",
        ...industryFields,
        ...(mileageSnapshot ?? {}),
        description: data.description,
        services: data.services ?? [],
        materials: data.materials,
        assignedEmployeeId: data.assignedEmployeeId || undefined,
        team: data.team ?? [],
        deadline: data.deadline,
      });

      const customPayload = collectCustomFieldPayload(orderFieldConfig, customValues);
      const createdOrderId = typeof created?.id === "string" ? created.id : "";
      if (customPayload.length > 0 && createdOrderId) {
        try {
          await saveCustomValues.mutateAsync({ orderId: createdOrderId, values: customPayload });
        } catch {
          submitLockRef.current = false;
          return;
        }
      }
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
          <Label htmlFor="client">{clientCfg?.label ?? t("orders.form.clientLabel")}</Label>
          <Controller
            name="clientId"
            control={control}
            render={({ field }) => (
              <ClientCombobox
                inputRef={(node) => {
                  clientInputRef.current = node;
                  if (typeof field.ref === "function") field.ref(node);
                  else if (field.ref) (field.ref as { current: HTMLInputElement | null }).current = node;
                }}
                errors={!!errors.clientId}
                clients={clientsForCombobox}
                value={clientName}
                placeholder={showVehicles ? t("clients.combobox.placeholderWithPlate") : undefined}
                vehicleHits={showVehicles ? vehicleRegistrationHits : undefined}
                vehicleHitsLoading={showVehicles && plateSearchEnabled ? vehicleRegistrationLoading : false}
                vehicleHitsError={showVehicles && plateSearchEnabled ? vehicleRegistrationError : false}
                onChange={(value) => {
                  setClientName(value);
                  field.onChange("");
                  setValue("vehicleId", "");
                  pendingVehicleIdRef.current = null;
                  if (isSubmitted) {
                    void trigger("clientId");
                  }
                }}
                onSelect={(client) => {
                  setClientName(client.name);
                  field.onChange(client.id);
                  setValue("vehicleId", "");
                  pendingVehicleIdRef.current = null;
                }}
                onSelectVehicle={
                  showVehicles
                    ? (hit) => {
                        setExtraClients((current) =>
                          current.some((client) => client.id === hit.client.id) ? current : [hit.client, ...current],
                        );
                        setClientName(hit.client.name);
                        field.onChange(hit.client.id);
                        setValue("vehicleId", hit.vehicleId, { shouldDirty: true });
                        pendingVehicleIdRef.current = hit.vehicleId;
                      }
                    : undefined
                }
                onCreateRequest={(name) => {
                  setClientName(name);
                  field.onChange("");
                  setValue("vehicleId", "");
                  pendingVehicleIdRef.current = null;
                  setClientDialogInitialName(name);
                  setClientDialogOpen(true);
                }}
              />
            )}
          />

          {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>}
          {selectedClientId ? (
            <p className="text-xs text-muted-foreground">
              {t("clients.combobox.selectedHint", {
                name: selectedClient?.name || clientName,
                phone: selectedClient?.phone?.trim() || t("clients.combobox.noPhone"),
              })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{copy.draftHint}</p>
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
            fieldConfig={orderFieldMap}
          />
        ) : null}

        <OrderAssetFields
          register={register}
          errors={errors}
          workflow={workflow}
          copy={copy}
          preserveHiddenValues
          hideVisibleFields={hideDuplicateVehicleAssetFields}
          fieldConfig={orderFieldMap}
        />

        <OrderIndustryFields
          register={register}
          setValue={setValue}
          errors={errors}
          blocks={industryBlocks}
          clientAddress={selectedClient?.address}
          disabled={isSubmitting}
          fieldConfig={orderFieldMap}
        />

        <OrderCustomFields
          fields={orderFieldConfig}
          values={customValues}
          errors={customErrors}
          disabled={isSubmitting}
          onChange={(key, value) => {
            setCustomValues((prev) => ({ ...prev, [key]: value }));
            setCustomErrors((prev) => {
              if (!prev[key]) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }}
        />

        <div className="space-y-1.5">
          <Label htmlFor="service">{servicesCfg?.label ?? copy.serviceLabel}</Label>

          <ServiceCombobox
            services={activeServices}
            allowCreate={canCreateServices}
            errors={!!errors.services?.root}
            onSelect={(service) => {
              const alreadyExists = serviceField.some((field) => field.serviceId === service.id);

              if (alreadyExists) return;

              const line = catalogServiceToOrderLine(service, warrantyDefaults, orderMileageUnit);
              serviceAppend(line);
              addPerformerToTeam(line.technicianId);
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
                warrantyKm: catalogWarrantyKmToOrderUnit(warranty.mileageLimit, orderMileageUnit),
                warrantyDays: null,
              });
              clearErrors("services");
            }}
          />
          {errors.services?.root?.message && <p className="text-xs text-destructive">{errors.services.root.message}</p>}

          {serviceField.length > 0 && (
            <div className="space-y-2">
              {serviceField.map((field, index) => {
                return (
                  <div key={field.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium [overflow-wrap:anywhere]">{field.serviceName}</p>
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
                    <Controller
                      name={`services.${index}.price`}
                      control={control}
                      rules={{
                        validate: (value) => {
                          const number = typeof value === "number" ? value : Number(value);
                          if ((value as unknown) === "" || !Number.isFinite(number) || number < 0) {
                            return t("orders.form.freeformPriceInvalid") as string;
                          }
                          return true;
                        },
                      }}
                      render={({ field: priceField }) => (
                        <OrderLinePriceField
                          id={`create-service-price-${index}`}
                          value={priceField.value as number | "" | null | undefined}
                          catalogPrice={activeServices?.find((service) => service.id === field.serviceId)?.service_price ?? null}
                          disabled={isSubmitting}
                          errorMessage={errors.services?.[index]?.price?.message}
                          formatMoney={formatMoney}
                          onChange={priceField.onChange}
                        />
                      )}
                    />
                    <OrderLinePerformerSelect
                      id={`create-service-performer-${index}`}
                      value={watchedServices?.[index]?.technicianId ?? ""}
                      options={technicianOptions}
                      disabled={isSubmitting}
                      onChange={(technicianId) => {
                        setValue(`services.${index}.technicianId`, technicianId || null, { shouldDirty: true });
                        addPerformerToTeam(technicianId);
                      }}
                    />
                    <OrderLineWarrantyFields
                      idPrefix={`create-service-${index}`}
                      months={watchedServices?.[index]?.warrantyMonths}
                      days={watchedServices?.[index]?.warrantyDays}
                      km={watchedServices?.[index]?.warrantyKm}
                      mileageUnit={orderMileageUnit}
                      showWarrantyKm={showWarrantyKm}
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

        {materialsCfg?.visible !== false ? (
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
            orderMileageUnit={orderMileageUnit}
            showWarrantyKm={showWarrantyKm}
            isSubmitted={isSubmitted}
            errors={errors.materials}
          />
        ) : null}

        {descriptionCfg?.visible !== false ? (
          <div className="space-y-1.5" data-edit-field="description">
            <Label htmlFor="description">
              {descriptionCfg?.label ?? t("orders.form.descriptionLabel")}
              {descriptionCfg?.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            <Textarea
              id="description"
              {...register("description", descriptionCfg?.required ? { required: t("settings.orderFields.validation.required") } : undefined)}
              placeholder={copy.descriptionPlaceholder}
              rows={3}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {assignedCfg?.visible !== false ? (
            <Controller
              name="assignedEmployeeId"
              control={control}
              rules={assignedCfg?.required ? { required: t("settings.orderFields.validation.required") } : undefined}
              render={({ field }) => (
                <OrderAssigneeSelect
                  id="assignedEmployeeId"
                  label={assignedCfg?.label ?? copy.assignedEmployeeLabel}
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
          ) : null}

          {deadlineCfg?.visible !== false ? (
            <div className="space-y-1.5" data-edit-field="deadline">
              <Label htmlFor="deadline">
                {deadlineCfg?.label ?? copy.deadlineLabel}
                {deadlineCfg?.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <div className="relative">
                <Input
                  id="deadline"
                  type="date"
                  {...register("deadline", deadlineCfg?.required ? { required: t("settings.orderFields.validation.required") } : undefined)}
                />
              </div>
            </div>
          ) : null}
        </div>

        {teamCfg?.visible !== false ? (
          <Controller
            name="team"
            control={control}
            render={({ field }) => (
              <OrderTeamSelect
                id="order-team"
                label={teamCfg?.label ?? t("orders.team.title")}
                value={field.value ?? []}
                options={technicianOptions}
                disabled={isSubmitting}
                onChange={field.onChange}
              />
            )}
          />
        ) : null}

        <OrderTotalsSummary
          money={orderMoney}
          formatMoney={formatMoney}
          clientDiscountPercents={{ services: orderMoney.servicePercent, products: orderMoney.productPercent }}
          vatRate={workspaceVatRate}
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

      <AddClientDialog
        open={clientDialogOpen}
        initialName={clientDialogInitialName}
        onOpenChange={(open) => {
          setClientDialogOpen(open);
          if (!open) {
            window.requestAnimationFrame(() => clientInputRef.current?.focus());
          }
        }}
        onCreated={({ client, vehicleId }) => {
          setExtraClients((previous) => [client, ...previous.filter((item) => item.id !== client.id)]);
          setClientName(client.name);
          setValue("clientId", client.id, { shouldDirty: true, shouldValidate: true });
          pendingVehicleIdRef.current = vehicleId;
          setValue("vehicleId", vehicleId ?? "", { shouldDirty: true });
          if (vehicleId) {
            void queryClient.invalidateQueries({ queryKey: clientVehiclesQueryKey(workspaceId, client.id) });
          }
        }}
      />
    </form>
  );
}
