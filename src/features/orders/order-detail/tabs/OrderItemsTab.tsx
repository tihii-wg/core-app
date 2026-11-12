import { memo, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderMaterial, OrderService } from "../../../../lib/types";
import type { AssignableTechnician } from "../../assignableTechnicians";
import OrderAddLinesSearch from "../../OrderAddLinesSearch";
import OrderWarehouseActions from "../../OrderWarehouseActions";
import type { AddOrderMaterialPrefill } from "../../AddOrderMaterialDialog";
import type { MaterialLineInlineField } from "../../OrderMaterialLineInlineCells";
import type { ServiceLineInlineField } from "../../OrderServiceLineInlineCells";
import { DetailItem } from "../detailHelpers";
import { OrderMaterialLinesTable } from "../OrderMaterialLinesTable";
import { OrderServiceLinesTable } from "../OrderServiceLinesTable";
import type { resolveCatalogLineStockLimit } from "../../catalogMaterialStockLimit";

export type OrderItemsTabProps = {
  order: Order;
  /** Order description (click-to-edit), shown right under the search field. */
  descriptionSlot?: ReactNode;
  industrySlug: string;
  showAddLinesSearch: boolean;
  showAddService: boolean;
  showAddMaterial: boolean;
  addLinesSearchFocusRef: MutableRefObject<(() => void) | null>;
  onServiceAdded: (updated: Order, meta?: { catalogServiceId?: string }) => void;
  onHighlightServiceLine: (serviceId: string) => void;
  onOpenMaterial: (prefill: AddOrderMaterialPrefill) => void;
  hasServiceLines: boolean;
  hasMaterialLines: boolean;
  serviceLines: OrderService[];
  materialLines: OrderMaterial[];
  fallbackService: string;
  highlightedServiceId: string | null;
  serviceLineEditLineId: string | null;
  serviceLineEditField: ServiceLineInlineField | null;
  materialLineEditLineId: string | null;
  materialLineEditField: MaterialLineInlineField | null;
  showFieldEdit: boolean;
  canDeleteServiceLine: boolean;
  canOpenServiceForm: boolean;
  canWarehouse: boolean;
  closedContentLocked: boolean;
  showWarrantyKm: boolean;
  formatMoney: (n: number) => string;
  locale: string;
  detailVatRate: number | null;
  performerOptions: AssignableTechnician[];
  materialSourceCustomer: string;
  warehouseNameById: Map<string, string>;
  purchasePriceById: Map<string, number>;
  warehouseStock: Parameters<typeof resolveCatalogLineStockLimit>[0]["stock"];
  updateServicePending: boolean;
  updateMaterialPending: boolean;
  deleteServicePending: boolean;
  deleteMaterialPending: boolean;
  onOpenServiceCatalog: (id: string) => void;
  onOpenMaterialCatalog: (id: string) => void;
  onRequestServiceEdit: (lineId: string, field: ServiceLineInlineField) => void;
  onRequestMaterialEdit: (lineId: string, field: MaterialLineInlineField) => void;
  onCancelServiceEdit: () => void;
  onCancelMaterialEdit: () => void;
  onSavedServiceEdit: () => void;
  onSavedMaterialEdit: () => void;
  onSaveServiceField: (lineId: string, field: ServiceLineInlineField, raw: string) => Promise<void>;
  onSaveMaterialField: (lineId: string, field: MaterialLineInlineField, raw: string) => Promise<void>;
  onDeleteService: (lineId: string) => void;
  onDeleteMaterial: (lineId: string) => void;
  onEditServiceLine: (lineId: string) => void;
  onEditMaterialLine: (lineId: string) => void;
  onEditorClosed: () => void;
  onOrderUpdated: (order: Order) => void;
};

function OrderItemsTabComponent(props: OrderItemsTabProps) {
  const { t } = useTranslation();
  const {
    order,
    industrySlug,
    showAddLinesSearch,
    showAddService,
    showAddMaterial,
    addLinesSearchFocusRef,
    onServiceAdded,
    onHighlightServiceLine,
    onOpenMaterial,
    hasServiceLines,
    hasMaterialLines,
    serviceLines,
    materialLines,
    fallbackService,
  } = props;

  return (
    <>
      {showAddLinesSearch ? (
        <div data-testid="order-items-actions">
          <OrderAddLinesSearch
            order={order}
            industrySlug={industrySlug}
            allowServices={showAddService}
            allowMaterials={showAddMaterial}
            focusRegistration={(focus) => {
              addLinesSearchFocusRef.current = focus;
            }}
            onServiceAdded={onServiceAdded}
            onHighlightServiceLine={onHighlightServiceLine}
            onOpenMaterial={onOpenMaterial}
          />
        </div>
      ) : null}
      {props.descriptionSlot ? <div data-testid="order-items-description">{props.descriptionSlot}</div> : null}
      {!hasServiceLines && !hasMaterialLines ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center" data-testid="order-items-empty">
          <p className="text-sm font-medium text-foreground">{t("orders.detail.tabs.itemsEmpty")}</p>
        </div>
      ) : null}
      {hasServiceLines ? (
        <OrderServiceLinesTable
          order={order}
          lines={serviceLines}
          highlightedServiceId={props.highlightedServiceId}
          serviceLineEditLineId={props.serviceLineEditLineId}
          serviceLineEditField={props.serviceLineEditField}
          showFieldEdit={props.showFieldEdit}
          canDelete={props.canDeleteServiceLine}
          canOpenServiceForm={props.canOpenServiceForm}
          showWarrantyKm={props.showWarrantyKm}
          formatMoney={props.formatMoney}
          locale={props.locale}
          detailVatRate={props.detailVatRate}
          performerOptions={props.performerOptions}
          saving={props.updateServicePending}
          deletePending={props.deleteServicePending}
          onOpenCatalog={props.onOpenServiceCatalog}
          onRequestEdit={props.onRequestServiceEdit}
          onCancelEdit={props.onCancelServiceEdit}
          onSavedEdit={props.onSavedServiceEdit}
          onSaveField={props.onSaveServiceField}
          onDelete={props.onDeleteService}
          onEditLine={props.onEditServiceLine}
          onEditorClosed={props.onEditorClosed}
        />
      ) : fallbackService ? (
        <DetailItem label={t("orders.detail.service")} value={fallbackService} />
      ) : null}

      {hasMaterialLines ? (
        <div className="space-y-3">
          <OrderMaterialLinesTable
            order={order}
            lines={materialLines}
            materialLineEditLineId={props.materialLineEditLineId}
            materialLineEditField={props.materialLineEditField}
            showFieldEdit={props.showFieldEdit}
            canWarehouse={props.canWarehouse}
            showWarrantyKm={props.showWarrantyKm}
            formatMoney={props.formatMoney}
            locale={props.locale}
            detailVatRate={props.detailVatRate}
            materialSourceCustomer={props.materialSourceCustomer}
            warehouseNameById={props.warehouseNameById}
            purchasePriceById={props.purchasePriceById}
            warehouseStock={props.warehouseStock}
            saving={props.updateMaterialPending}
            deletePending={props.deleteMaterialPending}
            onOpenCatalog={props.onOpenMaterialCatalog}
            onRequestEdit={props.onRequestMaterialEdit}
            onCancelEdit={props.onCancelMaterialEdit}
            onSavedEdit={props.onSavedMaterialEdit}
            onSaveField={props.onSaveMaterialField}
            onDelete={props.onDeleteMaterial}
            onEditLine={props.onEditMaterialLine}
            onEditorClosed={props.onEditorClosed}
          />
          <OrderWarehouseActions
            order={order}
            canManage={props.canWarehouse && !props.closedContentLocked}
            onOrderUpdated={props.onOrderUpdated}
          />
        </div>
      ) : null}
    </>
  );
}

export const OrderItemsTab = memo(OrderItemsTabComponent);
