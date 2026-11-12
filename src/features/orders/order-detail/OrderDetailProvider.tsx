import type { ReactNode } from "react";
import {
  OrderEditingProvider,
  OrderStaticProvider,
  type OrderEditingContextValue,
  type OrderStaticContextValue,
} from "./OrderDetailContext";

export type OrderDetailProviderProps = {
  staticValue: OrderStaticContextValue;
  editingValue: OrderEditingContextValue;
  children: ReactNode;
};

/** Dual-context provider: static order values stay stable while editing state changes. */
export function OrderDetailProvider({ staticValue, editingValue, children }: OrderDetailProviderProps) {
  return (
    <OrderStaticProvider value={staticValue}>
      <OrderEditingProvider value={editingValue}>{children}</OrderEditingProvider>
    </OrderStaticProvider>
  );
}

export type { OrderStaticContextValue, OrderEditingContextValue };
