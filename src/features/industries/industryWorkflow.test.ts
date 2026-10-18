import { describe, expect, it } from "vitest";
import {
  defaultServiceCategory,
  hiddenOrderAssetFields,
  industryClientCopy,
  industryInventoryCopy,
  industryModuleLabel,
  industryOrderStatusLabel,
  industryServiceCategoryOptions,
  industryShellCopy,
  industryWorkflow,
  orderAssetFieldRules,
  shouldShowOrderAssetValue,
} from "./industryWorkflow";

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
    expect(hiddenOrderAssetFields(workflow)).toEqual(["carNumber", "vin"]);
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
    expect(shouldShowOrderAssetValue(hidden, "", "vin")).toBe(false);
    expect(shouldShowOrderAssetValue(hidden, "1HGBH41JXMN109186", "vin")).toBe(true);
  });

  it("does not show empty plate or VIN shells even when automotive fields are configured", () => {
    const auto = industryWorkflow("auto_repair");
    expect(shouldShowOrderAssetValue(auto.orderFields.carNumber, "", "carNumber")).toBe(false);
    expect(shouldShowOrderAssetValue(auto.orderFields.vin, "", "vin")).toBe(false);
    expect(shouldShowOrderAssetValue(auto.orderFields.device, "", "device")).toBe(true);
  });

  it("exposes industry-relevant service categories from existing schema values", () => {
    expect(industryWorkflow("auto_repair").serviceCategories).toEqual(["repair", "assesment", "update"]);
    expect(industryWorkflow("phone_electronics_repair").serviceCategories).toEqual(["repair", "software", "data", "update", "assesment"]);
    expect(industryWorkflow("home_services").serviceCategories).toEqual(["repair", "assesment", "update"]);
    expect(industryWorkflow("other").serviceCategories).toContain("software");
    expect(defaultServiceCategory(industryWorkflow("auto_repair"))).toBe("repair");
  });

  it("keeps a service's current category selectable after an industry change", () => {
    const auto = industryWorkflow("auto_repair");
    expect(industryServiceCategoryOptions(auto)).not.toContain("software");
    expect(industryServiceCategoryOptions(auto, "software")).toEqual(["repair", "assesment", "update", "software"]);
    expect(industryServiceCategoryOptions(auto, "invented")).toEqual(["repair", "assesment", "update"]);
  });

  it("adapts client labels for field service without inventing schema fields", () => {
    const field = industryClientCopy(industryWorkflow("home_services"));
    expect(field.title).toBe("Customers");
    expect(field.addressLabel).toBe("Service address");
    expect(field.addClient).toBe("Add Customer");

    const auto = industryClientCopy(industryWorkflow("auto_repair"));
    expect(auto.title).toBe("Clients");
    expect(auto.addressLabel).toBe("Address");
    expect(auto.notesPlaceholder.toLowerCase()).toContain("fleet");
  });

  it("adapts inventory terminology from existing packs without inventing categories", () => {
    expect(industryWorkflow("auto_repair").terminology.inventory).toBe("parts");
    expect(industryWorkflow("home_services").terminology.inventory).toBe("supplies");

    const auto = industryInventoryCopy(industryWorkflow("auto_repair"));
    expect(auto.title).toBe("Parts");
    expect(auto.namePlaceholder.toLowerCase()).toContain("brake");

    const field = industryInventoryCopy(industryWorkflow("electrical_services"));
    expect(field.title).toBe("Supplies");
    expect(field.addItem).toBe("Add Supply");
    expect(field.namePlaceholder.toLowerCase()).not.toContain("brake");
  });

  it("unifies shell module labels with page terminology", () => {
    const field = industryWorkflow("home_services");
    expect(industryModuleLabel(field, "clients")).toBe("Customers");
    expect(industryModuleLabel(field, "inventory")).toBe("Supplies");
    expect(industryModuleLabel(field, "orders")).toBe("Orders");

    const shell = industryShellCopy(field);
    expect(shell.addClient).toBe("Add Customer");
    expect(shell.addInventory).toBe("Add Supply");
    expect(shell.noClientsTitle.toLowerCase()).toContain("customer");
  });

  it("adapts order status labels without changing stored status values", () => {
    expect(industryOrderStatusLabel(industryWorkflow("auto_repair"), "waiting-parts")).toBe("Waiting Parts");
    expect(industryOrderStatusLabel(industryWorkflow("home_services"), "waiting-parts")).toBe("Waiting Supplies");
    expect(industryOrderStatusLabel(industryWorkflow("home_services"), "in-progress")).toBe("In Progress");
    expect(industryOrderStatusLabel(industryWorkflow("phone_electronics_repair"), "completed")).toBe("Completed");
  });
});
