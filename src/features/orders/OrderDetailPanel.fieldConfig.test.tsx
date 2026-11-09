import { describe, expect, it } from "vitest";
import { industryProfile } from "../industries/industryProfile";
import { industryWorkflow } from "../industries/industryWorkflow";
import { mergeOrderFieldConfig, type CustomFieldDefinitionRow } from "./orderFieldConfig";
import { customEditFieldKey } from "./orderFieldRegistry";

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

describe("Order detail field labels from config", () => {
  it("uses overridden labels and custom edit keys for visible custom fields", () => {
    const profile = industryProfile("electronics_repair");
    const { fields } = mergeOrderFieldConfig({
      profile,
      workflow: industryWorkflow("electronics_repair"),
      definitions: [
        def({ fieldKey: "device", label: "Гаджет", isSystem: true, sortOrder: 20 }),
        def({
          fieldKey: "unlock_pin",
          label: "PIN",
          fieldType: "text",
          isSystem: false,
          sortOrder: 90,
        }),
      ],
    });

    expect(fields.find((field) => field.key === "device")?.label).toBe("Гаджет");
    const custom = fields.find((field) => field.key === "unlock_pin");
    expect(custom?.visible).toBe(true);
    expect(custom?.label).toBe("PIN");
    expect(customEditFieldKey(custom!.key)).toBe("custom:unlock_pin");
  });
});
