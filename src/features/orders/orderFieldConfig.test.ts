import { describe, expect, it } from "vitest";
import { industryProfile } from "../industries/industryProfile";
import { industryWorkflow } from "../industries/industryWorkflow";
import { mergeOrderFieldConfig, type CustomFieldDefinitionRow } from "./orderFieldConfig";

function def(partial: Partial<CustomFieldDefinitionRow> & Pick<CustomFieldDefinitionRow, "fieldKey" | "label">): CustomFieldDefinitionRow {
  return {
    id: partial.id ?? `def-${partial.fieldKey}`,
    workspaceId: "ws-1",
    entity: "order",
    orderTypeId: null,
    fieldType: partial.fieldType ?? "text",
    options: partial.options ?? [],
    defaultValue: null,
    templateVariable: null,
    isSystem: partial.isSystem ?? false,
    isRequired: partial.isRequired ?? false,
    showOnCard: false,
    readOnlyAfterCreate: false,
    sortOrder: partial.sortOrder ?? 100,
    isActive: partial.isActive ?? true,
    deletedAt: partial.deletedAt ?? null,
    fieldKey: partial.fieldKey,
    label: partial.label,
  };
}

describe("mergeOrderFieldConfig", () => {
  it("returns industry defaults for auto_repair without overrides", () => {
    const profile = industryProfile("auto_repair");
    const { fields } = mergeOrderFieldConfig({ profile, workflow: industryWorkflow("auto_repair"), definitions: [] });
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("device");
    expect(keys).toContain("carNumber");
    expect(keys).toContain("vin");
    expect(keys).not.toContain("deviceImei");
    expect(keys).not.toContain("siteAddress");
    expect(fields.find((f) => f.key === "client")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "services")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "status")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "total")?.canHide).toBe(false);
  });

  it("applies system overrides for label, visibility, required, sort", () => {
    const profile = industryProfile("auto_repair");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("auto_repair"),
      definitions: [
        def({
          fieldKey: "device",
          label: "Объект",
          isSystem: true,
          isActive: true,
          isRequired: true,
          sortOrder: 5,
        }),
        def({
          fieldKey: "vin",
          label: "VIN",
          isSystem: true,
          isActive: false,
          isRequired: false,
          sortOrder: 40,
        }),
      ],
    });
    const device = fields.find((f) => f.key === "device")!;
    expect(device.label).toBe("Объект");
    expect(device.required).toBe(true);
    expect(device.sortOrder).toBe(5);
    expect(fields.find((f) => f.key === "vin")?.visible).toBe(false);
    expect(fields[0]?.key).toBe("device");
  });

  it("includes custom fields and archives soft-deleted ones", () => {
    const profile = industryProfile("furniture_manufacturing");
    const { fields, archivedCustomFields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("furniture_manufacturing"),
      definitions: [
        def({ fieldKey: "color", label: "Цвет", fieldType: "select", sortOrder: 50, options: [{ value: "w", label: "White" }] }),
        def({ fieldKey: "old_note", label: "Old", deletedAt: "2026-01-01T00:00:00Z", isActive: false }),
      ],
    });
    expect(fields.find((f) => f.key === "color")).toMatchObject({
      isCustom: true,
      visible: true,
      type: "select",
    });
    expect(fields.find((f) => f.key === "siteAddress")).toBeTruthy();
    expect(fields.find((f) => f.key === "old_note")).toBeUndefined();
    expect(archivedCustomFields).toHaveLength(1);
    expect(archivedCustomFields[0]?.key).toBe("old_note");
  });

  it("does not allow hiding non-hideable fields even with is_active=false override", () => {
    const profile = industryProfile("other");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("other"),
      definitions: [
        def({ fieldKey: "client", label: "Клиент", isSystem: true, isActive: false }),
        def({ fieldKey: "services", label: "Услуги", isSystem: true, isActive: false }),
        def({ fieldKey: "status", label: "Статус", isSystem: true, isActive: false }),
        def({ fieldKey: "total", label: "Итого", isSystem: true, isActive: false }),
      ],
    });
    for (const key of ["client", "services", "status", "total"]) {
      expect(fields.find((f) => f.key === key)?.visible).toBe(true);
    }
  });

  it("hides built-ins that do not apply to phone industry", () => {
    const profile = industryProfile("phone_electronics_repair");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("phone_electronics_repair"),
      definitions: [def({ fieldKey: "vin", label: "VIN", isSystem: true, isActive: true })],
    });
    expect(fields.find((f) => f.key === "vin")).toBeUndefined();
    expect(fields.find((f) => f.key === "deviceImei")).toBeTruthy();
  });
});
