import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { resolveVariableLabel, segmentTextWithVariables } from "./variableDisplay";

const t = ((key: string) => {
  if (key.endsWith("order.number.label")) return "Order number";
  if (key.endsWith("client.name.label")) return "Client name";
  if (key.endsWith("vehicle.plate.label")) return "License plate";
  return key;
}) as TFunction;

describe("variableDisplay", () => {
  it("resolves known tokens to translated labels", () => {
    expect(resolveVariableLabel("#ЗАКАЗ-НОМЕР", t)).toMatchObject({
      known: true,
      label: "Order number",
    });
    expect(resolveVariableLabel("#КЛИЕНТ-ИМЯ", t).label).toBe("Client name");
  });

  it("marks unknown tokens", () => {
    expect(resolveVariableLabel("#НЕИЗВЕСТНО", t)).toEqual({
      token: "#НЕИЗВЕСТНО",
      label: "#НЕИЗВЕСТНО",
      known: false,
    });
  });

  it("segments text with inline tokens", () => {
    const segments = segmentTextWithVariables("Order #ЗАКАЗ-НОМЕР done", t);
    expect(segments).toEqual([
      { kind: "text", text: "Order " },
      { kind: "token", token: "#ЗАКАЗ-НОМЕР", label: "Order number", known: true },
      { kind: "text", text: " done" },
    ]);
  });

  it("exposes custom field keys as labels", () => {
    expect(resolveVariableLabel("{{order.custom.priority}}", t)).toMatchObject({
      known: true,
      label: "priority",
      group: "order",
    });
  });
});
