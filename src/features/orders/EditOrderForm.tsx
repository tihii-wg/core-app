import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { EditOrderFormData, Order } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import { catalogServiceToOrderLine } from "../services/orderServiceLine";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import useGetEmployees from "../employees/useGetEmployees";
import { useUpdateOrder } from "./useUpdateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { effectiveOrderVatRate } from "../finance/orderVat";
import { useWorkspaceVatRate } from "../finance/useWorkspaceVatRate";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";
import { canMutateOrderContent } from "./closedOrderPermissions";
import { defaultsForKind } from "./warranty";
import { catalogWarrantyKmToOrderUnit } from "./catalogWarranty";
import { canManageServices } from "../workspaces/workspaceRoles";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useGetClientDiscounts } from "../clients/useGetClientExtensions";
import OrderTotalsSummary from "./OrderTotalsSummary";
import { previewOrderMoney } from "./orderMoneyPreview";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { assignableTeamOptions, assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import OrderTeamSelect from "./OrderTeamSelect";
import OrderLinePerformerSelect from "./OrderLinePerformerSelect";
import { mergeOrderTeam } from "./orderTeam";
import OrderAssetFields from "./OrderAssetFields";
import { OrderVehicleFields } from "./OrderVehicleFields";
import {
  buildOrderMileageSnapshot,
  mileageFormValueFromOrder,
  persistOrderVehicleMileage,
} from "./orderVehicleMileage";
import { useClearHiddenOrderAssetErrors } from "./useClearHiddenOrderAssetErrors";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import OrderServiceKindSelect from "./OrderServiceKindSelect";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";
import OrderLinePriceField from "./OrderLinePriceField";
import { useOrderMileageUnitSync } from "./useOrderMileageUnit";

type EditOrderFormProps = {
  order: Order;
  onCancel: () => void;
  onUpdated: (order: Order) => void;
};

/** react-hook-form marks field-array dirtiness as nested objects/arrays — treat any nested true as dirty. */
function isFieldArrayDirty(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some((entry) => isFieldArrayDirty(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => isFieldArrayDirty(entry));
  }
  return false;
}

export default function EditOrderForm({ order, onCancel, onUpdated }: EditOrderFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateOrder } = useUpdateOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const { services } = useGetServices();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { formatMoney } = useWorkspaceMoney();
  const { rate: workspaceVatRate } = useWorkspaceVatRate();
  const { data: workspace } = useGetWorkspace();
  const warrantyDefaults = {
    serviceDurationMonths: workspace?.warrantyServiceMonths ?? null,
    serviceMileageLimit: workspace?.warrantyServiceKm ?? null,
    partsDurationMonths: workspace?.warrantyPartsMonths ?? null,
    partsMileageLimit: workspace?.warrantyPartsKm ?? null,
  };
  const { workflow, copy } = useIndustryWorkflow();
  const showVehicles = industrySupportsClientVehicles(workflow);
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const closedOrderPerms = useClosedOrderActionPermissions();
  const allowClosedMutation = canMutateOrderContent({
    order,
    isOwnerByOwnerId: closedOrderPerms.isOwnerByOwnerId,
    ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
  });
  const { vehicles: clientVehicles } = useGetClientVehicles(showVehicles ? order.clientId || null : null);
  const activeServices = services?.filter((service) => service.status === "active");
  const activeInventory = inventoryItems.filter((item) => item.isActive);
  const techniciansError = employeesError;
  const technicianOptions = assignableTechnicians(employees, order.assignedEmployeeId);
  // Team chips and line performers may reference employees that are no longer assignable (e.g. inactive) — keep them visible.
  const teamOptions = assignableTeamOptions(employees, order.assignedEmployeeId, [
    ...(order.team ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
    ...order.services.map((line) => ({ id: line.technicianId, name: line.technicianName })),
  ]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    clearErrors,
    trigger,
    formState: { errors, isSubmitting, isSubmitted, dirtyFields },
  } = useForm<EditOrderFormData>({
    defaultValues: {
      vehicleId: order.vehicleId ?? "",
      device: order.device,
      carNumber: order.carNumber,
      vin: order.vin,
      currentMileage: mileageFormValueFromOrder(order),
      description: order.description,
      assignedEmployeeId: order.assignedEmployeeId,
      team: (order.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role })),
      deadline: order.deadline,
      services: order.services,
      materials: order.materials ?? [],
    },
  });

  /** Adds a line performer to the team chips as a helper when not already present. */
  function addPerformerToTeam(employeeId: string | null | undefined) {
    const id = employeeId?.trim();
    if (!id) return;
    const current = getValues("team") ?? [];
    if (current.some((member) => member.employeeId === id)) return;
    setValue("team", mergeOrderTeam({ team: current, lineTechnicianIds: [id] }), { shouldDirty: true });
  }
  const warrantyDisabled = isSubmitting || (Boolean(order.closedAt) && !allowClosedMutation);

  useClearHiddenOrderAssetErrors(workflow, clearErrors);

  const {
    fields: serviceFields,
    append: serviceAppend,
    remove: serviceRemove,
  } = useFieldArray({
    control,
    name: "services",
    keyName: "fieldKey",
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
  const selectedVehicleId = useWatch({ control, name: "vehicleId" });
  /** Client-vehicle industries: order-level make/plate/VIN inputs are removed; preserve stored values on save. */
  const hideDuplicateVehicleAssetFields = showVehicles;
  // Saved lines keep their stored discount; lines added in this form get the client discount (as updateOrder stamps them).
  const { rows: clientDiscounts } = useGetClientDiscounts(order.clientId || null, Boolean(order.clientId));
  const orderMoney = previewOrderMoney(watchedServices, watchedMaterials, clientDiscounts, { skipSaved: true });
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
    snapshotUnit: order.vehicleMileageUnitSnapshot,
    handlers: mileageUnitHandlers,
  });

  useEffect(() => {
    if (hideDuplicateVehicleAssetFields) clearErrors(["device", "carNumber", "vin"]);
  }, [clearErrors, hideDuplicateVehicleAssetFields]);

  function hasService(serviceId: string | null, serviceName: string) {
    return serviceFields.some((field) => (serviceId !== null && field.serviceId === serviceId) || field.serviceName.toLowerCase() === serviceName.toLowerCase());
  }

  const onSubmit = async (data: EditOrderFormData) => {
    try {
      const selectedVehicleId = data.vehicleId?.trim() || "";
      let selectedVehicle = selectedVehicleId
        ? clientVehicles.find((vehicle) => vehicle.id === selectedVehicleId)
        : undefined;
      if (showVehicles && selectedVehicleId) {
        try {
          if (!selectedVehicle) throw new Error(t("vehicles.errors.invalidSelection"));
          guardWrite();
          // Mileage write first — failed vehicle update must not report the order as saved.
          await persistOrderVehicleMileage({
            workspaceId,
            clientId: selectedVehicle.clientId,
            vehicle: selectedVehicle,
            formMileage: data.currentMileage,
            queryClient,
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
          throw error;
        }
      }

      // Only rewrite the historical snapshot when the visit-mileage field was explicitly edited.
      const mileageSnapshot =
        dirtyFields.currentMileage && selectedVehicle
          ? buildOrderMileageSnapshot(data.currentMileage, selectedVehicle)
          : null;

      // Only sync service/material lines when the corresponding field arrays were edited.
      // Omitting them leaves persisted lines untouched (no unnecessary DELETE/RPC work).
      const servicesDirty = isFieldArrayDirty(dirtyFields.services);
      const materialsDirty = isFieldArrayDirty(dirtyFields.materials);

      // Vehicle industries: keep form snapshots (seeded from the order; refreshed only when the user changes vehicle).
      const updatedOrder = await updateOrder({
        orderId: order.id,
        vehicleId: data.vehicleId || "",
        device: showVehicles
          ? (data.device ?? "")
          : workflow.orderFields.device.visible
            ? data.device
            : order.device || data.device,
        carNumber: showVehicles
          ? (data.carNumber ?? "")
          : workflow.orderFields.carNumber.visible
            ? data.carNumber
            : order.carNumber,
        vin: showVehicles ? (data.vin ?? "") : workflow.orderFields.vin.visible ? data.vin : order.vin,
        ...(mileageSnapshot ?? {}),
        description: data.description,
        assignedEmployeeId: data.assignedEmployeeId,
        team: data.team ?? [],
        deadline: data.deadline,
        ...(servicesDirty ? { services: data.services ?? [] } : {}),
        ...(materialsDirty ? { materials: data.materials } : {}),
      });
      onUpdated(updatedOrder);
    } catch {
      // useUpdateOrder already toasts API failures.
      return;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {showVehicles && order.clientId ? (
        <OrderVehicleFields
          control={control}
          setValue={setValue}
          register={register}
          errors={errors}
          clientId={order.clientId}
          disabled={isSubmitting}
          mileageMode="vehicle"
          preserveInitialMileage
        />
      ) : null}

      <OrderAssetFields
        register={register}
        errors={errors}
        workflow={workflow}
        copy={copy}
        idPrefix="edit-order-"
        disabled={isSubmitting}
        preserveHiddenValues
        hideVisibleFields={hideDuplicateVehicleAssetFields}
      />

      <div className="space-y-1.5">
        <Label htmlFor="service">{t("orders.form.addServiceLabel")}</Label>
        <ServiceCombobox
          services={activeServices}
          allowCreate={canCreateServices}
          errors={!!errors.services?.root}
          onSelect={(service) => {
            if (hasService(service.id, service.service_name)) return;
            const line = catalogServiceToOrderLine(service, warrantyDefaults, orderMileageUnit);
            serviceAppend(line);
            addPerformerToTeam(line.technicianId);
            clearErrors("services");
          }}
          onCreate={(serviceName, price) => {
            if (hasService(null, serviceName)) return;
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
        {serviceFields.length > 0 && (
          <div className="space-y-2">
            {serviceFields.map((field, index) => (
              <div key={field.fieldKey} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{field.serviceName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OrderServiceKindSelect
                      value={watchedServices?.[index]?.kind}
                      lineName={field.serviceName}
                      disabled={isSubmitting}
                      onChange={(kind) => setValue(`services.${index}.kind`, kind, { shouldDirty: true })}
                    />
                    <Button type="button" variant="outline" onClick={() => serviceRemove(index)} disabled={isSubmitting} aria-label={t("orders.form.removeService", { name: field.serviceName })}>
                      {t("orders.form.remove")}
                    </Button>
                  </div>
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
                      id={`edit-service-price-${index}`}
                      value={priceField.value as number | "" | null | undefined}
                      catalogPrice={activeServices?.find((service) => service.id === field.serviceId)?.service_price ?? null}
                      disabled={warrantyDisabled}
                      errorMessage={errors.services?.[index]?.price?.message}
                      formatMoney={formatMoney}
                      onChange={priceField.onChange}
                    />
                  )}
                />
                <OrderLinePerformerSelect
                  id={`edit-service-performer-${index}`}
                  value={watchedServices?.[index]?.technicianId ?? ""}
                  options={teamOptions}
                  disabled={isSubmitting}
                  onChange={(technicianId) => {
                    setValue(`services.${index}.technicianId`, technicianId || null, { shouldDirty: true });
                    addPerformerToTeam(technicianId);
                  }}
                />
                <OrderLineWarrantyFields
                  idPrefix={`edit-service-${index}`}
                  months={watchedServices?.[index]?.warrantyMonths}
                  days={watchedServices?.[index]?.warrantyDays}
                  km={watchedServices?.[index]?.warrantyKm}
                  mileageUnit={orderMileageUnit}
                  disabled={warrantyDisabled}
                  onChange={({ warrantyMonths, warrantyDays, warrantyKm }) => {
                    setValue(`services.${index}.warrantyMonths`, warrantyMonths, { shouldDirty: true });
                    setValue(`services.${index}.warrantyDays`, warrantyDays, { shouldDirty: true });
                    setValue(`services.${index}.warrantyKm`, warrantyKm, { shouldDirty: true });
                  }}
                />
              </div>
            ))}
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
        warrantyDisabled={warrantyDisabled}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={orderMileageUnit}
        isSubmitted={isSubmitted}
        errors={errors.materials}
      />

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-description">{t("orders.form.descriptionLabel")}</Label>
        <Textarea id="edit-order-description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} disabled={isSubmitting} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Controller
          name="assignedEmployeeId"
          control={control}
          render={({ field }) => (
            <OrderAssigneeSelect
              id="edit-order-employee"
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
              onChange={(next) => {
                const previous = field.value ?? "";
                field.onChange(next);
                if (previous === next) return;
                // The assignee is always the team lead: drop the previous assignee chip and lead the team with the new one.
                const remaining = (getValues("team") ?? []).filter((member) => member.employeeId !== previous);
                setValue("team", mergeOrderTeam({ team: remaining, assignedEmployeeId: next }), { shouldDirty: true });
              }}
            />
          )}
        />

        <div className="space-y-1.5">
          <Label htmlFor="edit-order-deadline">{copy.deadlineLabel}</Label>
          <Input id="edit-order-deadline" type="date" {...register("deadline")} disabled={isSubmitting} />
        </div>
      </div>

      <Controller
        name="team"
        control={control}
        render={({ field }) => (
          <OrderTeamSelect
            id="edit-order-team"
            label={t("orders.team.title")}
            value={field.value ?? []}
            options={teamOptions}
            disabled={isSubmitting}
            onChange={field.onChange}
          />
        )}
      />

      <OrderTotalsSummary
        money={orderMoney}
        formatMoney={formatMoney}
        clientDiscountPercents={{ services: orderMoney.servicePercent, products: orderMoney.productPercent }}
        vatRate={effectiveOrderVatRate(order, workspaceVatRate)}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("common.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
