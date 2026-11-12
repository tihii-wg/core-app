import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Order, Vehicle } from "../../../../lib/types";
import type { IndustryWorkflow } from "../../../industries/industryWorkflow";
import { OrderClientCard } from "../../OrderClientCard";
import { OrderLinkedVehicleDetails } from "../../OrderLinkedVehicleDetails";
import OrderAssigneeSelect from "../../OrderAssigneeSelect";
import OrderTeamSelect from "../../OrderTeamSelect";
import type { OrderTeamMemberInput } from "../../orderTeam";
import type { AssignableTechnician } from "../../assignableTechnicians";
import { OrderInlineField } from "../../OrderInlineField";
import type { OrderFieldConfigItem } from "../../orderFieldConfig";
import type { OrderEditField } from "../../orderEditFields";
import {
  intakeMileageBelowKnownMessage,
  isIntakeMileageBelowKnown,
  parseVisitMileage,
} from "../../orderVehicleMileage";
import WarrantyOrderSection from "../../WarrantyOrderSection";
import { OrderWarrantyCoverageSection } from "../../OrderWarrantyCoverageSection";
import { isLegalEntityCustomer } from "../../taxInvoice";
import { TaxInvoiceNumberField } from "../TaxInvoiceNumberField";
import type { useIndustryWorkflow } from "../../../industries/useIndustryWorkflow";
import { OrderInfoFields } from "./OrderInfoFields";

export type OrderInfoTabProps = {
  order: Order;
  workflow: IndustryWorkflow;
  copy: ReturnType<typeof useIndustryWorkflow>["copy"];
  showClientVehicles: boolean;
  showFieldEdit: boolean;
  canChangeClientVehicle: boolean;
  canEditOrder: boolean;
  closedContentLocked: boolean;
  taxInvoiceRequired: boolean;
  onOrderUpdated: (order: Order) => void;
  onOpenClient?: (clientId: string) => void;
  onChangeClientRequest: () => void;
  orderFieldMap: Map<string, OrderFieldConfigItem>;
  orderFieldConfig: OrderFieldConfigItem[];
  customFieldValues: { definitionId: string; value: unknown }[];
  fieldLabel: (key: string, fallback: string) => string;
  fieldVisible: (key: string, industryDefault?: boolean) => boolean;
  showAssetField: (name: "device" | "carNumber" | "vin") => boolean;
  industryBlocks: Record<string, boolean>;
  deadline: string;
  overdue: boolean;
  description: string;
  editingField: OrderEditField | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inlineCommon: (field: OrderEditField) => any;
  renderTextField: (
    field: OrderEditField,
    label: string,
    current: string | null | undefined,
    options?: { kind?: "text" | "textarea"; mono?: boolean; masked?: boolean },
  ) => ReactNode;
  renderDateTimeField: (
    field: "measurementAt" | "installationAt",
    label: string,
    iso: string | null | undefined,
  ) => ReactNode;
  technicianOptions: AssignableTechnician[];
  teamOptions: AssignableTechnician[];
  isAssigneeUpdating: boolean;
  isStatusUpdating: boolean;
  assigneeErrorMessage: string | null;
  assigneeEmptyHint: string | null;
  onAssigneeChange: (id: string) => void;
  onTeamChange: (team: OrderTeamMemberInput[]) => void;
  customInlineKind: (type: string) => "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "datetime-local";
  customEditFieldKey: (key: string) => OrderEditField;
  linkedVehicle?: Vehicle | null;
};

function OrderInfoTabComponent(props: OrderInfoTabProps) {
  const { t } = useTranslation();
  const {
    order, workflow, copy, showClientVehicles, showFieldEdit, canChangeClientVehicle,
    canEditOrder, closedContentLocked, taxInvoiceRequired, onOrderUpdated, onOpenClient,
    onChangeClientRequest, orderFieldMap, orderFieldConfig, customFieldValues,
    fieldLabel, fieldVisible, showAssetField, industryBlocks, deadline, overdue,
    editingField, inlineCommon, renderTextField, renderDateTimeField,
    technicianOptions, teamOptions, isAssigneeUpdating, isStatusUpdating,
    assigneeErrorMessage, assigneeEmptyHint, onAssigneeChange, onTeamChange,
    customInlineKind, customEditFieldKey, linkedVehicle = null,
  } = props;

  return (
    <>

            {order.warrantySourceOrderId ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2" data-warranty-claim-banner>
                <p className="text-sm font-semibold text-foreground">{t("orders.warranty.claimTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("orders.warranty.claimHint")}</p>
              </div>
            ) : null}

            <WarrantyOrderSection
              order={order}
              currentMileage={order.vehicleMileageSnapshot ?? null}
              disabled={!canEditOrder || closedContentLocked}
              onChanged={() => {
                void onOrderUpdated(order);
              }}
            />

            <OrderWarrantyCoverageSection
              order={order}
              currentMileage={order.vehicleMileageSnapshot ?? null}
            />

            <OrderClientCard
              order={order}
              workflow={workflow}
              deviceLabel={fieldLabel("device", copy.deviceDetail)}
              carNumberLabel={fieldLabel("carNumber", copy.carNumberDetail)}
              vinLabel={fieldLabel("vin", copy.vinDetail)}
              interactive={canChangeClientVehicle}
              onChangeRequest={onChangeClientRequest}
              onOpenClient={onOpenClient}
              details={
                showClientVehicles ? (
              <OrderLinkedVehicleDetails
                vehicleId={order.vehicleId}
                vehicleMileageSnapshot={order.vehicleMileageSnapshot ?? null}
                vehicleMileageUnitSnapshot={order.vehicleMileageUnitSnapshot ?? null}
                onOpenRelatedOrder={(order) => {
                  onOrderUpdated(order);
                }}
                fieldConfig={orderFieldMap}
                renderRow={
                  showFieldEdit
                    ? (row) => {
                        // Only the visit mileage snapshot belongs to the order; every other vehicle value opens the vehicle card.
                        if (row.key !== "currentMileage") return undefined;
                        const snapshot = order.vehicleMileageSnapshot ?? null;
                        return (
                          <OrderInlineField
                            label={row.label}
                            value={snapshot == null ? "" : row.value}
                            editValue={snapshot}
                            kind="number"
                            getSoftWarning={
                              linkedVehicle
                                ? (draft) => {
                                    let reading: number | null = null;
                                    try {
                                      reading = parseVisitMileage(draft);
                                    } catch {
                                      return null;
                                    }
                                    if (
                                      !isIntakeMileageBelowKnown({
                                        reading,
                                        readingUnit:
                                          order.vehicleMileageUnitSnapshot ?? linkedVehicle.mileageUnit,
                                        vehicle: linkedVehicle,
                                      })
                                    ) {
                                      return null;
                                    }
                                    return intakeMileageBelowKnownMessage(linkedVehicle, t);
                                  }
                                : undefined
                            }
                            {...inlineCommon("vehicleCurrentMileage")}
                          />
                        );
                      }
                    : undefined
                }
              />
                ) : undefined
              }
            />

            {isLegalEntityCustomer(order.clientType) ? (
              <TaxInvoiceNumberField
                // Include persisted number in the key so a reopen/refetch that
                // brings a saved value remounts with the correct input state.
                key={`${order.id}:${order.taxInvoiceNumber ?? ""}`}
                order={order}
                required={taxInvoiceRequired}
                onSaved={onOrderUpdated}
              />
            ) : null}

            <OrderInfoFields
              order={order}
              copy={copy}
              showClientVehicles={showClientVehicles}
              showFieldEdit={showFieldEdit}
              deadline={deadline}
              overdue={overdue}
              editingField={editingField}
              orderFieldMap={orderFieldMap}
              orderFieldConfig={orderFieldConfig}
              customFieldValues={customFieldValues}
              fieldLabel={fieldLabel}
              fieldVisible={fieldVisible}
              showAssetField={showAssetField}
              industryBlocks={industryBlocks}
              inlineCommon={inlineCommon}
              renderTextField={renderTextField}
              renderDateTimeField={renderDateTimeField}
              customInlineKind={customInlineKind}
              customEditFieldKey={customEditFieldKey}
            />

            {fieldVisible("assignedEmployee") ? (
              <div className="border-t border-border pt-5">
                <OrderAssigneeSelect
                  id="order-assignee"
                  label={fieldLabel("assignedEmployee", copy.assignedEmployeeLabel)}
                  value={order.assignedEmployeeId}
                  options={technicianOptions}
                  disabled={!canEditOrder || closedContentLocked || isAssigneeUpdating || isStatusUpdating}
                  errorMessage={assigneeErrorMessage}
                  emptyHint={assigneeEmptyHint}
                  onChange={onAssigneeChange}
                />
              </div>
            ) : null}

            {fieldVisible("team") ? (
              <OrderTeamSelect
                id="order-team"
                label={fieldLabel("team", t("orders.team.title"))}
                value={(order.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role }))}
                options={teamOptions}
                disabled={!canEditOrder || closedContentLocked || isAssigneeUpdating || isStatusUpdating}
                onChange={onTeamChange}
              />
            ) : null}

            {/* The order description lives on the «Services & items» tab, under the search. */}
              

            {(order.createdAt || order.updatedAt) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground tabular-nums">
                {order.createdAt ? <p>{t("orders.detail.created", { date: order.createdAt })}</p> : null}
                {order.updatedAt ? <p>{t("orders.detail.updated", { date: order.updatedAt })}</p> : null}
              </div>
            )}
              
    </>
  );
}

export const OrderInfoTab = memo(OrderInfoTabComponent);
