import { describe, expect, it } from "vitest";
import { industryProfile, KNOWN_INDUSTRY_SLUGS } from "../industries/industryProfile";
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
  it("exposes vehicle fields for auto_repair instead of legacy device/plate/VIN", () => {
    const profile = industryProfile("auto_repair");
    const { fields } = mergeOrderFieldConfig({ profile, workflow: industryWorkflow("auto_repair"), definitions: [] });
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("vehicle");
    expect(keys).toContain("vehicleLicensePlate");
    expect(keys).toContain("vehicleVin");
    expect(keys).toContain("vehicleMake");
    expect(keys).not.toContain("device");
    expect(keys).not.toContain("carNumber");
    expect(keys).not.toContain("vin");
    expect(keys).not.toContain("deviceImei");
    expect(keys).not.toContain("siteAddress");
    expect(fields.find((f) => f.key === "vehicle")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "client")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "services")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "status")?.canHide).toBe(false);
    expect(fields.find((f) => f.key === "total")?.canHide).toBe(false);
  });

  it("applies legacy carNumber/vin overrides onto vehicleLicensePlate/vehicleVin", () => {
    const profile = industryProfile("auto_repair");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("auto_repair"),
      definitions: [
        def({
          fieldKey: "carNumber",
          label: "Госномер",
          isSystem: true,
          isActive: true,
          isRequired: true,
          sortOrder: 5,
        }),
        def({
          fieldKey: "vin",
          label: "Кузов",
          isSystem: true,
          isActive: false,
          sortOrder: 40,
        }),
      ],
    });
    const plate = fields.find((f) => f.key === "vehicleLicensePlate")!;
    expect(plate.label).toBe("Госномер");
    expect(plate.required).toBe(true);
    expect(plate.sortOrder).toBe(5);
    expect(fields.find((f) => f.key === "vehicleVin")?.visible).toBe(false);
    expect(fields.find((f) => f.key === "vehicleVin")?.label).toBe("Кузов");
  });

  it("prefers explicit vehicle* overrides over legacy fallbacks", () => {
    const profile = industryProfile("auto_repair");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("auto_repair"),
      definitions: [
        def({ fieldKey: "carNumber", label: "Legacy plate", isSystem: true, sortOrder: 1 }),
        def({ fieldKey: "vehicleLicensePlate", label: "New plate", isSystem: true, sortOrder: 2 }),
      ],
    });
    expect(fields.find((f) => f.key === "vehicleLicensePlate")?.label).toBe("New plate");
  });

  it("keeps legacy device/carNumber/vin for non-vehicle industries", () => {
    const profile = industryProfile("home_services");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("home_services"),
      definitions: [
        def({
          fieldKey: "device",
          label: "Объект",
          isSystem: true,
          isActive: true,
          isRequired: true,
          sortOrder: 5,
        }),
      ],
    });
    expect(fields.find((f) => f.key === "device")?.label).toBe("Объект");
    expect(fields.find((f) => f.key === "vehicle")).toBeUndefined();
    expect(fields.find((f) => f.key === "carNumber")).toBeUndefined();
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
      group: "custom",
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

  it("covers every known industry with registry fields", () => {
    for (const slug of KNOWN_INDUSTRY_SLUGS) {
      const profile = industryProfile(slug);
      const { fields } = mergeOrderFieldConfig({ profile, workflow: industryWorkflow(slug), definitions: [] });
      expect(fields.length).toBeGreaterThan(5);
      expect(fields.some((f) => f.key === "client")).toBe(true);
      expect(fields.some((f) => f.key === "services")).toBe(true);
      if (profile.navigation.clientVehicles) {
        expect(fields.some((f) => f.key === "vehicle")).toBe(true);
        expect(fields.some((f) => f.key === "device")).toBe(false);
      }
    }
  });
});
