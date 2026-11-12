import { createContext, useContext, type ReactNode } from "react";
import type { Order } from "../../../lib/types";
import type { IndustryWorkflow } from "../../industries/industryWorkflow";
import type { useIndustryWorkflow } from "../../industries/useIndustryWorkflow";
import type { OrderEditField } from "../orderEditFields";
import type { MaterialLineInlineEditTarget } from "../OrderMaterialLineInlineCells";
import type { ServiceLineInlineEditTarget } from "../OrderServiceLineInlineCells";

export type OrderStaticContextValue = {
  selectedOrder: Order;
  formatMoney: (value: number) => string;
  workspaceVatRate: number | null;
  workflow: IndustryWorkflow;
  copy: ReturnType<typeof useIndustryWorkflow>["copy"];
  industrySlug: string;
  canEditOrder: boolean;
  closedContentLocked: boolean;
  showFieldEdit: boolean;
  canWarehouse: boolean;
  canOpenServiceForm: boolean;
  canChangeClientVehicle: boolean;
  showWarrantyKm: boolean;
  onOrderUpdated: (order: Order) => void;
  locale: string;
};

export type OrderEditingContextValue = {
  editingField: OrderEditField | null;
  serviceLineEdit: ServiceLineInlineEditTarget | null;
  materialLineEdit: MaterialLineInlineEditTarget | null;
  setEditingField: (field: OrderEditField | null) => void;
  setServiceLineEdit: (target: ServiceLineInlineEditTarget | null) => void;
  setMaterialLineEdit: (target: MaterialLineInlineEditTarget | null) => void;
  highlightedServiceId: string | null;
};

const OrderStaticContext = createContext<OrderStaticContextValue | null>(null);
const OrderEditingContext = createContext<OrderEditingContextValue | null>(null);

export function OrderStaticProvider({
  value,
  children,
}: {
  value: OrderStaticContextValue;
  children: ReactNode;
}) {
  return <OrderStaticContext.Provider value={value}>{children}</OrderStaticContext.Provider>;
}

export function OrderEditingProvider({
  value,
  children,
}: {
  value: OrderEditingContextValue;
  children: ReactNode;
}) {
  return <OrderEditingContext.Provider value={value}>{children}</OrderEditingContext.Provider>;
}

export function useOrderStatic() {
  const value = useContext(OrderStaticContext);
  if (!value) throw new Error("useOrderStatic requires OrderStaticProvider");
  return value;
}

export function useOrderEditing() {
  const value = useContext(OrderEditingContext);
  if (!value) throw new Error("useOrderEditing requires OrderEditingProvider");
  return value;
}

/** Optional — history column / shell pieces that may render without an order. */
export function useOrderStaticOptional() {
  return useContext(OrderStaticContext);
}
