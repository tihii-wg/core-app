import type { Order, OrderMaterial, OrderService } from "../../lib/types";

export type OrderLineCommentRow = {
  order_service_id?: string | null;
  order_material_id?: string | null;
  body?: string | null;
};

export type OrderLineCommentsByLine = {
  services: Map<string, string>;
  materials: Map<string, string>;
};

/** Split DB rows into service/material maps (trimmed non-empty body only). */
export function indexOrderLineComments(rows: readonly OrderLineCommentRow[] | null | undefined): OrderLineCommentsByLine {
  const services = new Map<string, string>();
  const materials = new Map<string, string>();
  for (const row of rows ?? []) {
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!body) continue;
    const serviceId = typeof row.order_service_id === "string" ? row.order_service_id.trim() : "";
    const materialId = typeof row.order_material_id === "string" ? row.order_material_id.trim() : "";
    if (serviceId) services.set(serviceId, body);
    else if (materialId) materials.set(materialId, body);
  }
  return { services, materials };
}

/** Merge comment maps onto order line objects (immutable). */
export function mergeOrderLineComments<T extends Pick<Order, "services" | "materials">>(
  order: T,
  comments: OrderLineCommentsByLine | null | undefined,
): T {
  if (!comments) return order;
  const services = (order.services ?? []).map((line: OrderService) => {
    const id = line.id?.trim();
    if (!id) return line.comment === null ? line : { ...line, comment: null };
    const body = comments.services.get(id);
    // Loaded comments are authoritative: no row → explicitly null (a stale comment is never kept).
    if (body == null) return line.comment === null ? line : { ...line, comment: null };
    return line.comment === body ? line : { ...line, comment: body };
  });
  const materials = (order.materials ?? []).map((line: OrderMaterial) => {
    const id = line.id?.trim();
    if (!id) return line.comment === null ? line : { ...line, comment: null };
    const body = comments.materials.get(id);
    // Loaded comments are authoritative: no row → explicitly null (a stale comment is never kept).
    if (body == null) return line.comment === null ? line : { ...line, comment: null };
    return line.comment === body ? line : { ...line, comment: body };
  });
  return { ...order, services, materials };
}

/** Strip comments from every line (print private mode / public-status page). */
export function stripOrderLineComments<T extends Pick<Order, "services" | "materials">>(order: T): T {
  const services = (order.services ?? []).map((line) =>
    line.comment == null || line.comment === undefined ? line : { ...line, comment: null },
  );
  const materials = (order.materials ?? []).map((line) =>
    line.comment == null || line.comment === undefined ? line : { ...line, comment: null },
  );
  return { ...order, services, materials };
}

/** Optimistic patch of one line comment on an order snapshot. */
export function withOrderLineComment(
  order: Order,
  kind: "service" | "material",
  lineId: string,
  body: string | null,
): Order {
  const nextBody = body?.trim() ? body.trim() : null;
  if (kind === "service") {
    return {
      ...order,
      services: (order.services ?? []).map((line) =>
        line.id === lineId ? { ...line, comment: nextBody } : line,
      ),
    };
  }
  return {
    ...order,
    materials: (order.materials ?? []).map((line) =>
      line.id === lineId ? { ...line, comment: nextBody } : line,
    ),
  };
}

export const ORDER_LINE_COMMENT_MAX = 500;

export function normalizeOrderLineCommentBody(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, ORDER_LINE_COMMENT_MAX);
}
