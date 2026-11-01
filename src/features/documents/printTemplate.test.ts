import { describe, expect, it } from "vitest";
import { applyPrintVariables, buildPrintDocument, sanitizeTemplateHtml } from "./printTemplate";

describe("printTemplate", () => {
  it("substitutes variables and escapes values", () => {
    const out = applyPrintVariables("<p>#ЗАКАЗ-НОМЕР / #КЛИЕНТ-ИМЯ / #СТАТУС / #ВАЛЮТА / #ДРУГОЕ</p>", {
      orderNumber: "ORD-1",
      clientName: "<b>Ada</b>",
      status: "New",
      currency: "RON",
    });
    expect(out).toBe("<p>ORD-1 / &lt;b&gt;Ada&lt;/b&gt; / New / RON / #ДРУГОЕ</p>");
  });

  it("strips scripts, handlers and javascript urls", () => {
    const out = sanitizeTemplateHtml(
      '<div onclick="x()"><script>alert(1)</script><a href="javascript:alert(1)">a</a><img src=x onerror="y()"><b>ok</b></div>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(out).toContain("<b>ok</b>");
  });

  it("builds a standalone document", () => {
    expect(buildPrintDocument("<p>x</p>", "T")).toContain("<body><p>x</p></body>");
  });
});
