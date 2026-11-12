import { describe, expect, it } from "vitest";
import type { Order } from "../../../lib/types";
import { emptyPrintContext } from "../templateVariables";
import { applyTemplateVariables } from "../printTemplate";
import { stripOrderLineComments } from "../../orders/orderLineComments";
import { canvasRowsForSource } from "./tableData";

function orderWithComment(): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [
      {
        id: "svc-1",
        serviceId: "s1",
        serviceName: "Oil <b>change</b>",
        price: 100,
        quantity: 1,
        comment: 'Check <script>alert(1)</script> & more',
      },
    ],
    materials: [],
    description: "",
    status: "in_progress",
    assignedEmployeeId: null,
    assignedEmployeeName: null,
    createdByName: null,
    deadline: "",
    totalPrice: 100,
    discountTotal: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
  } as unknown as Order;
}

describe("print line comments", () => {
  it("fills canvas rows when comments are present (public print payload)", () => {
    const ctx = emptyPrintContext({ order: orderWithComment() });
    const rows = canvasRowsForSource("services", ctx);
    expect(rows[0]?.comment).toBe('Check <script>alert(1)</script> & more');
  });

  it("leaves comment empty after private strip", () => {
    const ctx = emptyPrintContext({ order: stripOrderLineComments(orderWithComment()) });
    const rows = canvasRowsForSource("services", ctx);
    expect(rows[0]?.comment).toBe("");
  });

  it("renders escaped comment under the name in legacy HTML tables", () => {
    const ctx = emptyPrintContext({ order: orderWithComment() });
    const html = applyTemplateVariables("#ТАБЛИЦА-УСЛУГ", ctx);
    expect(html).toContain("Oil &lt;b&gt;change&lt;/b&gt;");
    expect(html).toContain("Check &lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
