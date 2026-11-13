import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { useConfirm } from "../../ui/ConfirmProvider";
import type { EditOrderFormData, Order, OrderMaterial, OrderService } from "../../lib/types";
import { getWarrantyRecordsForOrder } from "../../services/apiWarranty";
import useGetServices from "../services/useGetServices";
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
import { isWarrantySourceFormallyClosed, type WarrantySnapshot } from "./warranty";
import { formatWarrantyEndsOn } from "./OrderWarrantyIndicator";
import { OrderWarrantyPauseNotice } from "./OrderWarrantyPauseNotice";
import { canManageServices } from "../workspaces/workspaceRoles";
import { industrySupportsClientVehicles, industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryProfile } from "../industries/industryProfile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useGetClientDiscounts } from "../clients/useGetClientExtensions";
import { useGetClient } from "../clients/useGetClient";
import OrderTotalsSummary from "./OrderTotalsSummary";
import { previewOrderMoney } from "./orderMoneyPreview";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { assignableTeamOptions, assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import OrderTeamSelect from "./OrderTeamSelect";
import { mergeOrderTeam } from "./orderTeam";
import OrderAssetFields from "./OrderAssetFields";
import OrderIndustryFields from "./OrderIndustryFields";
import {
  OrderCustomFields,
  collectCustomFieldPayload,
  validateRequiredCustomFields,
  type OrderCustomFieldValues,
} from "./OrderCustomFields";
import { fieldConfigMap, useOrderCustomFieldValues, useOrderFieldConfig, useSaveOrderCustomFieldValues } from "./useOrderFieldConfig";
import {
  emptyOrderIndustryFormFields,
  isInstallationBeforeMeasurement,
  orderIndustryFieldsToApi,
  orderIndustryFormFieldsFromOrder,
} from "./industryOrderFieldHelpers";
import { OrderVehicleFields } from "./OrderVehicleFields";
import {
  buildOrderMileageSnapshot,
  mileageFormValueFromOrder,
  persistOrderVehicleMileage,
} from "./orderVehicleMileage";
import { useClearHiddenOrderAssetErrors } from "./useClearHiddenOrderAssetErrors";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import OrderServiceLinesFields from "./OrderServiceLinesFields";
import { useOrderMileageUnitSync } from "./useOrderMileageUnit";
import { registerOrderUnsavedEdits } from "./orderUnsavedEdits";
import { focusOrderEditField, type OrderEditField } from "./orderEditFields";
import { getOrder } from "../../services/apiOrders";
import { RemoteOrderEditNotice } from "../realtime/RemoteOrderEditNotice";
import { useRemoteOrderEditNotice } from "../realtime/useRemoteOrderEditNotice";

type EditOrderFormProps = {
  order: Order;
  onCancel: () => void;
  onUpdated: (order: Order) => void;
  /**
   * Soft sync after a remote reload (keep the edit form open). Defaults to onUpdated
   * only when the caller does not close the panel on save.
   */
  onOrderSynced?: (order: Order) => void;
  /** When set, scroll/focus the matching `[data-edit-field]` after mount. */
  initialFocusField?: OrderEditField;
  /** Mirrors the form's submitting state (lets the panel footer show a spinner for the same save). */
  onSubmittingChange?: (submitting: boolean) => void;
};

function editFormDefaultsFromOrder(order: Order): EditOrderFormData {
  return {
    vehicleId: order.vehicleId ?? "",
    device: order.device,
    carNumber: order.carNumber,
    vin: order.vin,
    ...emptyOrderIndustryFormFields(),
    ...orderIndustryFormFieldsFromOrder(order),
    currentMileage: mileageFormValueFromOrder(order),
    description: order.description,
    assignedEmployeeId: order.assignedEmployeeId,
    team: (order.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role })),
    deadline: order.deadline,
    services: order.services,
    materials: order.materials ?? [],
  };
}

/**
 * Imperative handle for external save buttons (the order panel footer).
 * `submit()` runs the same validation / save as the in-form Save button and resolves true only when the
 * order was saved (`onUpdated` has been called); false on validation or API failure.
 */
export type EditOrderFormHandle = { submit: () => Promise<boolean> };

/** react-hook-form marks field-array dirtiness as nested objects/arrays — treat any nested true as dirty. */
function isFieldArrayDirty(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some((entry) => isFieldArrayDirty(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => isFieldArrayDirty(entry));
  }
  return false;
}

function warrantyCatalogKeyForService(line: Pick<OrderService, "serviceId" | "serviceName">): string | null {
  const catalogId = line.serviceId?.trim();
  if (catalogId) return `service:${catalogId}`;
  const name = line.serviceName?.trim().toLowerCase();
  return name ? `service-name:${name}` : null;
}

function warrantyCatalogKeyForMaterial(line: Pick<OrderMaterial, "inventoryItemId" | "itemName">): string | null {
  const catalogId = line.inventoryItemId?.trim();
  if (catalogId) return `material:${catalogId}`;
  const name = line.itemName?.trim().toLowerCase();
  return name ? `material-name:${name}` : null;
}

function findServiceWarrantyRecord(
  records: readonly WarrantySnapshot[],
  line: Pick<OrderService, "id">,
): WarrantySnapshot | undefined {
  const lineId = line.id?.trim();
  if (!lineId) return undefined;
  return records.find((row) => row.orderServiceId === lineId);
}

function findMaterialWarrantyRecord(
  records: readonly WarrantySnapshot[],
  line: Pick<OrderMaterial, "id">,
): WarrantySnapshot | undefined {
  const lineId = line.id?.trim();
  if (!lineId) return undefined;
  return records.find((row) => row.orderMaterialId === lineId);
}

const EditOrderForm = forwardRef<EditOrderFormHandle, EditOrderFormProps>(function EditOrderForm(
  { order, onCancel, onUpdated, onOrderSynced, initialFocusField, onSubmittingChange },
  ref,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { mutateAsync: updateOrder } = useUpdateOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const formRef = useRef<HTMLFormElement>(null);
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
  const { workflow, copy, profile, industrySlug } = useIndustryWorkflow();
  const showVehicles = industrySupportsClientVehicles(workflow);
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const industryBlocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const orderFieldMap = useMemo(() => fieldConfigMap(orderFieldConfig), [orderFieldConfig]);
  const { data: customValues = [] } = useOrderCustomFieldValues(order.id);
  const saveCustomValues = useSaveOrderCustomFieldValues();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const closedOrderPerms = useClosedOrderActionPermissions();
  const allowClosedMutation = canMutateOrderContent({
    order,
    isOwnerByOwnerId: closedOrderPerms.isOwnerByOwnerId,
    ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
    workspaceRole: closedOrderPerms.role,
    grants: closedOrderPerms.grants,
  });
  const { vehicles: clientVehicles } = useGetClientVehicles(showVehicles ? order.clientId || null : null);
  const { client: orderClient } = useGetClient(industryBlocks.siteAddress ? order.clientId || null : null);
  const activeServices = services?.filter((service) => service.status === "active");
  const activeInventory = inventoryItems.filter((item) => item.isActive);
  const techniciansError = employeesError;
  const technicianOptions = assignableTechnicians(employees, order.assignedEmployeeId);
  // Team chips and line performers may reference employees that are no longer assignable (e.g. inactive) — keep them visible.
  const teamOptions = assignableTeamOptions(employees, order.assignedEmployeeId, [
    ...(order.team ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
    ...order.services.map((line) => ({ id: line.technicianId, name: line.technicianName })),
  ]);

  const [customFieldState, setCustomFieldState] = useState<OrderCustomFieldValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const defaults: OrderCustomFieldValues = {};
    for (const field of orderFieldConfig) {
      if (!field.isCustom || !field.definitionId) continue;
      const row = customValues.find((value) => value.definitionId === field.definitionId);
      const raw = row?.value;
      if (field.type === "checkbox") defaults[field.key] = raw === true || raw === "true";
      else if (raw == null) defaults[field.key] = "";
      else defaults[field.key] = typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw);
    }
    setCustomFieldState((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(defaults);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => Object.prototype.hasOwnProperty.call(prev, key) && prev[key] === defaults[key])
      ) {
        return prev;
      }
      return defaults;
    });
  }, [orderFieldConfig, customValues]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    clearErrors,
    trigger,
    reset,
    formState: { errors, isSubmitting, isSubmitted, dirtyFields, isDirty },
  } = useForm<EditOrderFormData>({
    defaultValues: editFormDefaultsFromOrder(order),
  });

  const { showNotice: showRemoteNotice, dismiss: dismissRemoteNotice, acknowledgeReload } =
    useRemoteOrderEditNotice(order.id, isDirty);
  const [remoteRefreshing, setRemoteRefreshing] = useState(false);

  const reloadFromRemote = async () => {
    if (!workspaceId || remoteRefreshing) return;
    setRemoteRefreshing(true);
    try {
      const fresh = await getOrder(order.id, workspaceId);
      reset(editFormDefaultsFromOrder(fresh));
      acknowledgeReload();
      (onOrderSynced ?? onUpdated)(fresh);
    } catch {
      toast.error(t("orders.detail.remoteChangedFailed"));
    } finally {
      setRemoteRefreshing(false);
    }
  };

  /** Adds a line performer to the team chips as a helper when not already present. */
  function addPerformerToTeam(employeeId: string | null | undefined) {
    const id = employeeId?.trim();
    if (!id) return;
    const current = getValues("team") ?? [];
    if (current.some((member) => member.employeeId === id)) return;
    setValue("team", mergeOrderTeam({ team: current, lineTechnicianIds: [id] }), { shouldDirty: true });
  }
  const warrantyDisabled = isSubmitting || (Boolean(order.closedAt) && !allowClosedMutation);
  const sourceClosed = isWarrantySourceFormallyClosed(order);
  const [restartWarrantyHints, setRestartWarrantyHints] = useState<Set<string>>(() => new Set());

  const warrantyRecordsQuery = useQuery({
    queryKey: ["warranty-records", workspaceId, order.id],
    queryFn: () => getWarrantyRecordsForOrder(workspaceId, order.id),
    enabled: Boolean(workspaceId && !sourceClosed),
  });
  const warrantyRecords = warrantyRecordsQuery.data ?? [];

  useClearHiddenOrderAssetErrors(workflow, clearErrors);

  async function requestRemoveService(index: number) {
    const line = getValues(`services.${index}`);
    if (!line) return;
    const record = findServiceWarrantyRecord(warrantyRecords, line);
    if (record) {
      const dateLabel = formatWarrantyEndsOn(record.startsAt?.slice(0, 10) ?? null) ?? record.startsAt.slice(0, 10);
      const proceed = await confirm({
        title: t("orders.form.remove"),
        description: t("orders.warranty.deleteWarrantyLineConfirm", {
          name: line.serviceName,
          date: dateLabel,
        }),
        confirmLabel: t("orders.form.remove"),
        cancelLabel: t("common.cancel"),
        tone: "destructive",
        icon: "warning",
      });
      if (!proceed) return;
      const key = warrantyCatalogKeyForService(line);
      if (key) setRestartWarrantyHints((prev) => new Set(prev).add(key));
    }
    serviceRemove(index);
  }

  async function requestRemoveMaterial(index: number) {
    const line = getValues(`materials.${index}`);
    if (!line) return;
    const record = findMaterialWarrantyRecord(warrantyRecords, line);
    if (record) {
      const dateLabel = formatWarrantyEndsOn(record.startsAt?.slice(0, 10) ?? null) ?? record.startsAt.slice(0, 10);
      const proceed = await confirm({
        title: t("orders.form.remove"),
        description: t("orders.warranty.deleteWarrantyLineConfirm", {
          name: line.itemName,
          date: dateLabel,
        }),
        confirmLabel: t("orders.form.remove"),
        cancelLabel: t("common.cancel"),
        tone: "destructive",
        icon: "warning",
      });
      if (!proceed) return;
      const key = warrantyCatalogKeyForMaterial(line);
      if (key) setRestartWarrantyHints((prev) => new Set(prev).add(key));
    }
    materialRemove(index);
  }

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
    enabled: showWarrantyKm,
  });

  useEffect(() => {
    if (hideDuplicateVehicleAssetFields) clearErrors(["device", "carNumber", "vin"]);
  }, [clearErrors, hideDuplicateVehicleAssetFields]);

  const saveOrder = async (data: EditOrderFormData): Promise<Order | null> => {
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

    const industryFields = orderIndustryFieldsToApi(data);
    if (isInstallationBeforeMeasurement(industryFields.measurementAt, industryFields.installationAt)) {
      toast.error(t("orders.validation.installationBeforeMeasurement"));
      return null;
    }

    // Vehicle industries: keep form snapshots (seeded from the order; refreshed only when the user changes vehicle).
    const requiredErrors = validateRequiredCustomFields(
      orderFieldConfig,
      customFieldState,
      t("settings.orderFields.validation.required"),
    );
    if (Object.keys(requiredErrors).length > 0) {
      setCustomErrors(requiredErrors);
      return null;
    }

    const updated = await updateOrder({
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
      ...industryFields,
      ...(mileageSnapshot ?? {}),
      description: data.description,
      assignedEmployeeId: data.assignedEmployeeId,
      team: data.team ?? [],
      deadline: data.deadline,
      ...(servicesDirty ? { services: data.services ?? [] } : {}),
      ...(materialsDirty ? { materials: data.materials } : {}),
    });

    const customPayload = collectCustomFieldPayload(orderFieldConfig, customFieldState);
    if (customPayload.length > 0) {
      await saveCustomValues.mutateAsync({ orderId: order.id, values: customPayload });
    }
    return updated;
  };

  const descriptionCfg = orderFieldMap.get("description");
  const assignedCfg = orderFieldMap.get("assignedEmployee");
  const teamCfg = orderFieldMap.get("team");
  const deadlineCfg = orderFieldMap.get("deadline");
  const materialsCfg = orderFieldMap.get("materials");

  /** Shared by the Save button and the imperative `submit()`; true only when the order was saved. */
  const onSubmit = async (data: EditOrderFormData): Promise<boolean> => {
    try {
      const updatedOrder = await saveOrder(data);
      if (!updatedOrder) return false;
      onUpdated(updatedOrder);
      return true;
    } catch {
      // useUpdateOrder already toasts API failures.
      return false;
    }
  };

  const submitRef = useRef<() => Promise<boolean>>(async () => false);
  submitRef.current = () =>
    new Promise<boolean>((resolve) => {
      void handleSubmit(
        async (data) => resolve(await onSubmit(data)),
        () => resolve(false),
      )();
    });
  useImperativeHandle(ref, () => ({ submit: () => submitRef.current() }), []);

  const onSubmittingChangeRef = useRef(onSubmittingChange);
  onSubmittingChangeRef.current = onSubmittingChange;
  useEffect(() => {
    onSubmittingChangeRef.current?.(isSubmitting);
  }, [isSubmitting]);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const saveViaSessionRef = useRef<() => Promise<Order | null>>(async () => null);
  // Used by close/payment entry points: persist without navigating away (caller updates local state).
  saveViaSessionRef.current = () =>
    new Promise<Order | null>((resolve) => {
      void handleSubmit(
        async (data) => {
          try {
            resolve(await saveOrder(data));
          } catch {
            resolve(null);
          }
        },
        () => resolve(null),
      )();
    });

  useEffect(() => {
    return registerOrderUnsavedEdits(order.id, {
      isDirty: () => isDirtyRef.current,
      save: () => saveViaSessionRef.current(),
    });
  }, [order.id]);

  useEffect(() => {
    if (!initialFocusField) return;
    let cancelled = false;
    // Double rAF: wait until the sheet content (and nested field blocks) are painted.
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || !formRef.current) return;
        focusOrderEditField(formRef.current, initialFocusField);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [initialFocusField]);

  return (
    <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {showRemoteNotice ? (
        <RemoteOrderEditNotice
          onRefresh={() => void reloadFromRemote()}
          onDismiss={dismissRemoteNotice}
          refreshing={remoteRefreshing}
        />
      ) : null}
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
          preserveInitialAssetSnapshot
          fieldConfig={orderFieldMap}
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
        fieldConfig={orderFieldMap}
      />

      <OrderIndustryFields
        register={register}
        setValue={setValue}
        errors={errors}
        blocks={industryBlocks}
        clientAddress={orderClient?.address}
        idPrefix="edit-order-"
        disabled={isSubmitting}
        fieldConfig={orderFieldMap}
      />

      <OrderCustomFields
        fields={orderFieldConfig}
        values={customFieldState}
        errors={customErrors}
        idPrefix="edit-order-"
        disabled={isSubmitting}
        onChange={(key, value) => {
          setCustomFieldState((prev) => ({ ...prev, [key]: value }));
          setCustomErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }}
      />

      <OrderWarrantyPauseNotice order={order} records={warrantyRecords} />

      <OrderServiceLinesFields
        control={control as never}
        fields={serviceFields}
        append={serviceAppend}
        onRemove={(index) => void requestRemoveService(index)}
        setValue={setValue}
        catalogServices={activeServices}
        allowCreate={canCreateServices}
        performerOptions={teamOptions}
        onPerformerChosen={addPerformerToTeam}
        onLineAdded={() => clearErrors("services")}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={orderMileageUnit}
        showWarrantyKm={showWarrantyKm}
        disabled={isSubmitting}
        warrantyDisabled={warrantyDisabled}
        idPrefix="edit-service"
        label={t("orders.form.addServiceLabel")}
        errors={errors.services}
        restartHintForLine={(line) => {
          const key = warrantyCatalogKeyForService(line);
          return Boolean(key && restartWarrantyHints.has(key));
        }}
      />

      {materialsCfg?.visible !== false ? (
        <OrderMaterialLinesEditor
          control={control as never}
          fields={materialFields}
          append={materialAppend}
          remove={(index) => {
            if (typeof index === "number") void requestRemoveMaterial(index);
            else materialRemove(index);
          }}
          setValue={setValue}
          getValues={getValues}
          trigger={trigger as never}
          inventoryItems={activeInventory}
          disabled={isSubmitting}
          warrantyDisabled={warrantyDisabled}
          warrantyDefaults={warrantyDefaults}
          orderMileageUnit={orderMileageUnit}
          showWarrantyKm={showWarrantyKm}
          isSubmitted={isSubmitted}
          errors={errors.materials}
          restartWarrantyHints={restartWarrantyHints}
          warrantyCatalogKeyForLine={warrantyCatalogKeyForMaterial}
        />
      ) : null}

      {descriptionCfg?.visible !== false ? (
        <div className="space-y-1.5" data-edit-field="description">
          <Label htmlFor="edit-order-description">
            {descriptionCfg?.label ?? t("orders.form.descriptionLabel")}
            {descriptionCfg?.required ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Textarea
            id="edit-order-description"
            {...register("description", descriptionCfg?.required ? { required: t("settings.orderFields.validation.required") } : undefined)}
            placeholder={copy.descriptionPlaceholder}
            rows={3}
            disabled={isSubmitting}
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
                id="edit-order-employee"
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
        ) : null}

        {deadlineCfg?.visible !== false ? (
          <div className="space-y-1.5" data-edit-field="deadline">
            <Label htmlFor="edit-order-deadline">
              {deadlineCfg?.label ?? copy.deadlineLabel}
              {deadlineCfg?.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            <Input
              id="edit-order-deadline"
              type="date"
              {...register("deadline", deadlineCfg?.required ? { required: t("settings.orderFields.validation.required") } : undefined)}
              disabled={isSubmitting}
            />
          </div>
        ) : null}
      </div>

      {teamCfg?.visible !== false ? (
        <Controller
          name="team"
          control={control}
          render={({ field }) => (
            <OrderTeamSelect
              id="edit-order-team"
              label={teamCfg?.label ?? t("orders.team.title")}
              value={field.value ?? []}
              options={teamOptions}
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
});

export default EditOrderForm;
