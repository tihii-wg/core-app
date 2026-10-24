import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { findCachedOrder, patchOrderTaxInvoiceInCache } from "./useGetOrders";
import type { OrdersPageResult } from "../../services/apiOrders";

const baseOrder = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Org SA",
  clientType: "organization" as const,
  orderNumber: "ORD-1",
  device: "BMW",
  vin: "",
  carNumber: "",
  service: "Oil",
  services: [],
  description: "",
  status: "completed" as const,
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 10,
  isPaid: false,
  paymentStatus: "unpaid" as const,
  taxInvoiceNumber: "",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} satisfies Order;

describe("order tax invoice query cache helpers", () => {
  it("patches taxInvoiceNumber on list and page caches so reopen sees the saved value", () => {
    const client = new QueryClient();
    const workspaceId = "ws-1";

    client.setQueryData(["orders", workspaceId], [{ ...baseOrder }]);
    client.setQueryData(["orders", workspaceId, "page", { page: 1 }], {
      orders: [{ ...baseOrder }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    } satisfies OrdersPageResult);

    patchOrderTaxInvoiceInCache(client, workspaceId, "order-1", "FV-CACHE-1");

    expect((client.getQueryData(["orders", workspaceId]) as Order[])[0].taxInvoiceNumber).toBe("FV-CACHE-1");
    expect(
      (client.getQueryData(["orders", workspaceId, "page", { page: 1 }]) as OrdersPageResult).orders[0].taxInvoiceNumber,
    ).toBe("FV-CACHE-1");
  });

  it("findCachedOrder prefers the cache entry that already has a tax invoice number", () => {
    const client = new QueryClient();
    const workspaceId = "ws-1";

    client.setQueryData(["orders", workspaceId], [{ ...baseOrder, taxInvoiceNumber: "" }]);
    client.setQueryData(["orders", workspaceId, "page", { page: 1 }], {
      orders: [{ ...baseOrder, taxInvoiceNumber: "FV-FROM-PAGE" }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    } satisfies OrdersPageResult);

    expect(findCachedOrder(client, workspaceId, "order-1")?.taxInvoiceNumber).toBe("FV-FROM-PAGE");
  });
});
