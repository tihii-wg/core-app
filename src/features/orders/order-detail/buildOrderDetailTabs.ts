import type { TFunction } from "i18next";
import {
  orderDetailItemsCount,
  usesWorksAndMaterialsTabLabel,
  type OrderDetailTab,
} from "../orderDetailTabs";

export function buildOrderDetailTabs(args: {
  t: TFunction;
  industrySlug: string | null | undefined;
  serviceLineCount: number;
  materialLineCount: number;
  linkedPaymentCount: number;
  attachmentsFetched: boolean;
  attachmentCount: number;
  isDesktopFeedLayout: boolean;
  feedItemCount: number | null;
}): { value: OrderDetailTab; label: string }[] {
  const {
    t,
    industrySlug,
    serviceLineCount,
    materialLineCount,
    linkedPaymentCount,
    attachmentsFetched,
    attachmentCount,
    isDesktopFeedLayout,
    feedItemCount,
  } = args;
  const itemsCount = orderDetailItemsCount(serviceLineCount, materialLineCount);
  return [
    { value: "info", label: t("orders.detail.tabs.info") },
    {
      value: "items",
      label: t(usesWorksAndMaterialsTabLabel(industrySlug) ? "orders.detail.tabs.itemsWorks" : "orders.detail.tabs.items", {
        count: itemsCount,
      }),
    },
    {
      value: "payments",
      label:
        linkedPaymentCount > 0
          ? t("orders.detail.tabs.paymentsWithCount", { count: linkedPaymentCount })
          : t("orders.detail.tabs.payments"),
    },
    {
      value: "files",
      label:
        attachmentsFetched && attachmentCount > 0
          ? t("orders.detail.tabs.filesWithCount", { count: attachmentCount })
          : t("orders.detail.tabs.files"),
    },
    ...(isDesktopFeedLayout
      ? []
      : [
          {
            value: "history" as const,
            label:
              feedItemCount != null
                ? t("orders.detail.tabs.historyWithCount", { count: feedItemCount })
                : t("orders.detail.tabs.history"),
          },
        ]),
  ];
}
