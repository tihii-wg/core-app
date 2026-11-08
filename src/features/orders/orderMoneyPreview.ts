import type { OrderMaterial, OrderService } from "../../lib/types";
import { parseOrderMaterialQuantity } from "../inventory/orderMaterialLine";
import {
  clientDiscountPercent,
  computeOrderMoney,
  stampClientDiscountsOnLines,
  type ClientDiscountLike,
  type OrderMoney,
} from "./orderTotals";

type PreviewService = Pick<OrderService, "id" | "price" | "quantity" | "discountType" | "discountValue">;
type PreviewMaterial = Pick<OrderMaterial, "id" | "price" | "quantity" | "discountType" | "discountValue">;

export type OrderMoneyPreview = OrderMoney & { servicePercent: number; productPercent: number; hasClientDiscount: boolean };

/**
 * Subtotal / discount / total shown in the order forms: the same math the API persists.
 * Lines that already exist (`id`) keep their stored discount (edit form); new lines get the client's
 * `service_order` / `product_order` percent exactly like `createOrder` / `updateOrder` stamp them.
 */
export function previewOrderMoney(
  services: readonly PreviewService[] | undefined,
  materials: readonly PreviewMaterial[] | undefined,
  clientDiscounts: readonly ClientDiscountLike[],
  options: { skipSaved?: boolean } = {},
): OrderMoneyPreview {
  const stamped = stampClientDiscountsOnLines(
    (services ?? []).map((line) => ({ ...line, price: Number(line.price) || 0 })),
    (materials ?? []).map((line) => ({ ...line, price: Number(line.price) || 0 })),
    clientDiscounts,
    options,
  );
  const money = computeOrderMoney({
    // Line totals use round(price * qty, 2) via computeOrderMoney / lineGross (same as DB).
    services: stamped.services.map((line) => ({
      price: line.price,
      qty: parseOrderMaterialQuantity(line.quantity) ?? 0,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })),
    materials: stamped.materials.map((line) => ({
      price: line.price,
      qty: parseOrderMaterialQuantity(line.quantity) ?? 0,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })),
  });
  const servicePercent = clientDiscountPercent(clientDiscounts, "service_order");
  const productPercent = clientDiscountPercent(clientDiscounts, "product_order");
  return { ...money, servicePercent, productPercent, hasClientDiscount: servicePercent > 0 || productPercent > 0 };
}
