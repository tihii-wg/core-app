import { OrderDetailProvider } from "./OrderDetailProvider";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { useOrderDetailModel, type OrderDetailPanelProps } from "./useOrderDetailModel";

export type { OrderDetailPanelProps };

export default function OrderDetailPanel(props: OrderDetailPanelProps) {
  const model = useOrderDetailModel(props);
  const sheet = <OrderDetailSheet {...model} />;

  if (!model.staticContextValue) {
    return sheet;
  }

  return (
    <OrderDetailProvider staticValue={model.staticContextValue} editingValue={model.editingContextValue}>
      {sheet}
    </OrderDetailProvider>
  );
}
