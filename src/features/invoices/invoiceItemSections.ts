import type { InvoiceItem } from "../../lib/types";

/**
 * Works/materials classification for invoice items.
 *
 * `invoice_items` has no kind column. At creation time
 * (createInvoiceFromOrder) the items are copied as
 * [...order_services, ...order_materials] with sequential positions:
 * services keep their catalog `service_id`, materials are stored with
 * `service_id = null` and the material name in `service_name`.
 * Order services are always resolved to a catalog service before being
 * saved (apiOrders), so in practice `service_id` is set for works.
 *
 * Classification is therefore:
 *   1. `serviceId` present            -> WORKS
 *   2. `serviceId` null + source order available -> the ambiguous
 *      lines are matched, in position order, against the order's own
 *      null-serviceId service lines first and its material lines
 *      second (exactly the concatenation order used at creation).
 *      This rescues legacy service lines that genuinely have no id.
 *   3. `serviceId` null + no source order -> MATERIALS (the marker the
 *      creation code itself writes for materials). This fallback is
 *      documented: it can misclassify a historical ad-hoc service
 *      line whose order no longer exists, but it never changes any
 *      price, quantity, or the grand total.
 *
 * Every input item ends up in exactly one section exactly once.
 */

export type InvoiceItemKind = "works" | "materials";

export type InvoiceSections = {
  works: InvoiceItem[];
  materials: InvoiceItem[];
  worksSubtotal: number;
  materialsSubtotal: number;
  grandTotal: number;
};

export type InvoiceOrderLines = {
  services: { serviceId: string | null; serviceName: string; price: number; quantity: number }[];
  materials: { itemName: string; price: number; quantity: number }[];
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function lineTotal(item: Pick<InvoiceItem, "price" | "quantity">) {
  return roundMoney(item.price * item.quantity);
}

export function sectionSubtotal(items: InvoiceItem[]) {
  return roundMoney(items.reduce((sum, item) => sum + lineTotal(item), 0));
}

type Triple = { name: string; price: number; quantity: number };

function itemTriple(item: InvoiceItem): Triple {
  return { name: item.serviceName.trim().toLowerCase(), price: item.price, quantity: item.quantity };
}

function tripleMatches(a: Triple, b: Triple) {
  return a.name === b.name && a.price === b.price && a.quantity === b.quantity;
}

export function classifyInvoiceItems(items: InvoiceItem[], orderLines?: InvoiceOrderLines | null): InvoiceSections {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const works: InvoiceItem[] = [];
  const materials: InvoiceItem[] = [];
  const ambiguous: InvoiceItem[] = [];

  for (const item of sorted) {
    if (item.serviceId) works.push(item);
    else ambiguous.push(item);
  }

  if (ambiguous.length > 0) {
    if (orderLines) {
      const customServices: Triple[] = orderLines.services
        .filter((line) => !line.serviceId)
        .map((line) => ({ name: line.serviceName.trim().toLowerCase(), price: line.price, quantity: line.quantity }));
      const materialLines: Triple[] = orderLines.materials.map((line) => ({
        name: line.itemName.trim().toLowerCase(),
        price: line.price,
        quantity: line.quantity,
      }));

      if (ambiguous.length === customServices.length + materialLines.length) {
        // Exact snapshot: services were copied before materials.
        ambiguous.forEach((item, index) => {
          if (index < customServices.length) works.push(item);
          else materials.push(item);
        });
      } else {
        // Order was edited after invoicing: match in order against the
        // remaining service lines first, then material lines.
        const pendingServices = [...customServices];
        const pendingMaterials = [...materialLines];
        for (const item of ambiguous) {
          const triple = itemTriple(item);
          const serviceIndex = pendingServices.findIndex((line) => tripleMatches(line, triple));
          const materialIndex = pendingMaterials.findIndex((line) => tripleMatches(line, triple));
          if (serviceIndex >= 0 && (materialIndex < 0 || serviceIndex <= materialIndex)) {
            pendingServices.splice(serviceIndex, 1);
            works.push(item);
          } else if (materialIndex >= 0) {
            pendingMaterials.splice(materialIndex, 1);
            materials.push(item);
          } else if (pendingServices.length > 0 && pendingMaterials.length === 0) {
            works.push(item);
          } else {
            materials.push(item);
          }
        }
      }
    } else {
      // Fallback (see header): null service_id is the material marker.
      materials.push(...ambiguous);
    }
  }

  const byPosition = (a: InvoiceItem, b: InvoiceItem) => a.position - b.position;
  works.sort(byPosition);
  materials.sort(byPosition);

  const worksSubtotal = sectionSubtotal(works);
  const materialsSubtotal = sectionSubtotal(materials);
  return {
    works,
    materials,
    worksSubtotal,
    materialsSubtotal,
    grandTotal: roundMoney(worksSubtotal + materialsSubtotal),
  };
}
