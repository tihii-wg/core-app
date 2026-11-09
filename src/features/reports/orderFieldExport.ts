import {
  displayCustomFieldValue,
  getCustomFieldValuesForEntities,
  getOrderFieldDefinitions,
  type CustomFieldValueRow,
} from "../../services/apiCustomFields";
import { industryProfile } from "../industries/industryProfile";
import { industryWorkflow } from "../industries/industryWorkflow";
import { mergeOrderFieldConfig, type CustomFieldDefinitionRow } from "../orders/orderFieldConfig";
import type { OrdersListSectionOptions } from "./quickReports";

/** Build CSV/report options from workspace order field definitions + values. Soft-fails empty. */
export async function loadOrdersListFieldOptions(
  workspaceId: string | undefined,
  orderIds: string[],
  industrySlug?: string | null,
): Promise<OrdersListSectionOptions> {
  if (!workspaceId?.trim() || orderIds.length === 0) return {};

  let definitions: CustomFieldDefinitionRow[] = [];
  let values: CustomFieldValueRow[] = [];
  try {
    [definitions, values] = await Promise.all([
      getOrderFieldDefinitions(workspaceId),
      getCustomFieldValuesForEntities(workspaceId, orderIds),
    ]);
  } catch {
    return {};
  }

  const profile = industryProfile(industrySlug);
  const workflow = industryWorkflow(industrySlug);
  const { fields } = mergeOrderFieldConfig({ profile, workflow, definitions });

  const columnLabels = {
    client: fields.find((field) => field.key === "client")?.label,
    status: fields.find((field) => field.key === "status")?.label,
    total: fields.find((field) => field.key === "total")?.label,
  };

  const customColumns = fields
    .filter((field) => field.isCustom && field.visible && field.definitionId)
    .map((field) => {
      const valuesByOrderId: Record<string, string> = {};
      for (const row of values) {
        if (row.definitionId !== field.definitionId) continue;
        valuesByOrderId[row.entityId] = displayCustomFieldValue(field.type, row.value, field.options);
      }
      return {
        key: `custom_${field.key}`,
        header: field.label,
        valuesByOrderId,
      };
    });

  return { columnLabels, customColumns };
}
