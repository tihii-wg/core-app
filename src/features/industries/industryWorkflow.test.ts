import { describe, expect, it } from "vitest";
import { industryWorkflow, orderAssetFieldRules, shouldShowOrderAssetValue } from "./industryWorkflow";

describe("industryWorkflow", () => {
  it("shows automotive fields for auto_repair", () => {
    const workflow = industryWorkflow("auto_repair");
    expect(workflow.orderFields.device).toEqual({ visible: true, required: true });
    expect(workflow.orderFields.carNumber).toEqual({ visible: true, required: true });
    expect(workflow.orderFields.vin).toEqual({ visible: true, required: true, exactLength: 17 });
    expect(workflow.copyPack).toBe("auto_repair");
  });

  it("hides automotive fields for home_services", () => {
    const workflow = industryWorkflow("home_services");
    expect(workflow.orderFields.device.visible).toBe(true);
    expect(workflow.orderFields.carNumber.visible).toBe(false);
    expect(workflow.orderFields.vin.visible).toBe(false);
    expect(workflow.orderFields.carNumber.required).toBe(false);
    expect(workflow.orderFields.vin.required).toBe(false);
    expect(workflow.copyPack).toBe("field_service");
  });

  it("switches configuration when the industry slug changes", () => {
    expect(industryWorkflow("auto_repair").orderFields.vin.visible).toBe(true);
    expect(industryWorkflow("electrical_services").orderFields.vin.visible).toBe(false);
    expect(industryWorkflow("phone_electronics_repair").copyPack).toBe("repair_device");
  });

  it("uses safe defaults for unknown or missing industries", () => {
    expect(industryWorkflow(null).orderFields.vin.visible).toBe(false);
    expect(industryWorkflow("space_travel").orderFields.carNumber.visible).toBe(false);
  });

  it("does not require hidden fields", () => {
    const hidden = industryWorkflow("home_services").orderFields.vin;
    expect(orderAssetFieldRules(hidden, { required: "VIN is required", length: "bad" })).toEqual({});
  });

  it("keeps historical vehicle values visible on detail when the field is otherwise hidden", () => {
    const hidden = industryWorkflow("home_services").orderFields.vin;
    expect(shouldShowOrderAssetValue(hidden, "")).toBe(false);
    expect(shouldShowOrderAssetValue(hidden, "1HGBH41JXMN109186")).toBe(true);
  });
});
