import { memo } from "react";
import { Tabs, TabsList, TabsTrigger } from "../../../ui/Tabs";
import { isOrderDetailTab, type OrderDetailTab } from "../orderDetailTabs";

export type OrderDetailTabsProps = {
  detailTab: OrderDetailTab;
  onSelectTab: (tab: OrderDetailTab) => void;
  isDesktopFeedLayout: boolean;
  tabs: { value: OrderDetailTab; label: string }[];
};

function OrderDetailTabsComponent({ detailTab, onSelectTab, isDesktopFeedLayout, tabs }: OrderDetailTabsProps) {
  return (
    <div className="shrink-0 border-b border-border px-5 py-1.5" data-testid="order-detail-tabs">
      {/* Mobile widths also expose the legacy test id so existing mobile-tab lookups keep working. */}
      <div data-testid={isDesktopFeedLayout ? undefined : "order-detail-mobile-tabs"}>
        <Tabs value={detailTab} onValueChange={(value) => isOrderDetailTab(value) && onSelectTab(value)}>
          <TabsList className="h-auto w-full flex-nowrap justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-11 min-h-11 shrink-0">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}

export const OrderDetailTabs = memo(OrderDetailTabsComponent);
