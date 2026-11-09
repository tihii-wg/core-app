import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createCustomOrderField,
  CustomFieldsUnavailableError,
  getCustomFieldValuesForEntities,
  getCustomFieldValuesForEntity,
  getOrderFieldDefinitions,
  resetAllSystemOrderFieldOverrides,
  resetSystemOrderFieldOverride,
  softDeleteCustomOrderField,
  updateCustomOrderField,
  upsertCustomFieldValues,
  upsertSystemOrderFieldOverride,
  type CreateCustomOrderFieldInput,
  type UpdateCustomOrderFieldInput,
  type UpsertSystemOrderFieldOverrideInput,
} from "../../services/apiCustomFields";
import { industryProfile } from "../industries/industryProfile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { mergeOrderFieldConfig, type OrderFieldConfigItem } from "./orderFieldConfig";

export function orderFieldConfigQueryKey(workspaceId: string | undefined, industrySlug: string | null | undefined) {
  return ["order-field-config", workspaceId, industrySlug ?? "other"] as const;
}

export function useOrderFieldConfig() {
  const { workspaceId } = useActiveWorkspaceId();
  const { workflow, industrySlug, profile: workflowProfile } = useIndustryWorkflow();
  const profile = workflowProfile ?? industryProfile(industrySlug);

  const query = useQuery({
    queryKey: orderFieldConfigQueryKey(workspaceId, industrySlug),
    queryFn: async () => {
      try {
        return await getOrderFieldDefinitions(workspaceId);
      } catch (error) {
        if (error instanceof CustomFieldsUnavailableError) return [];
        throw error;
      }
    },
    enabled: Boolean(workspaceId),
  });

  const merged = mergeOrderFieldConfig({
    profile,
    workflow,
    definitions: query.data ?? [],
  });

  return {
    fields: merged.fields,
    archivedCustomFields: merged.archivedCustomFields,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isUnavailable: query.error instanceof CustomFieldsUnavailableError,
  };
}

export function useOrderCustomFieldValues(orderId: string | null | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = orderId?.trim() ?? "";

  return useQuery({
    queryKey: ["custom-field-values", workspaceId, id],
    queryFn: () => getCustomFieldValuesForEntity(workspaceId, id),
    enabled: Boolean(workspaceId && id),
  });
}

/** Batch-load custom field values for many orders (list columns / client search). */
export function useOrderCustomFieldValuesForOrders(orderIds: string[]) {
  const { workspaceId } = useActiveWorkspaceId();
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))].sort();

  return useQuery({
    queryKey: ["custom-field-values-batch", workspaceId, ids.join(",")],
    queryFn: () => getCustomFieldValuesForEntities(workspaceId, ids),
    enabled: Boolean(workspaceId && ids.length > 0),
  });
}

function invalidateOrderFieldConfig(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  void queryClient.invalidateQueries({ queryKey: ["order-field-config", workspaceId] });
}

export function useUpsertSystemOrderFieldOverride() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: UpsertSystemOrderFieldOverrideInput) => {
      guardWrite();
      return upsertSystemOrderFieldOverride(workspaceId, input);
    },
    onSuccess: () => invalidateOrderFieldConfig(queryClient, workspaceId),
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useCreateCustomOrderField() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: CreateCustomOrderFieldInput) => {
      guardWrite();
      return createCustomOrderField(workspaceId, input);
    },
    onSuccess: () => {
      invalidateOrderFieldConfig(queryClient, workspaceId);
      toast.success(i18n.t("settings.orderFields.toast.created"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useUpdateCustomOrderField() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: UpdateCustomOrderFieldInput) => {
      guardWrite();
      return updateCustomOrderField(workspaceId, input);
    },
    onSuccess: () => invalidateOrderFieldConfig(queryClient, workspaceId),
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useSoftDeleteCustomOrderField() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (definitionId: string) => {
      guardWrite();
      return softDeleteCustomOrderField(workspaceId, definitionId);
    },
    onSuccess: () => {
      invalidateOrderFieldConfig(queryClient, workspaceId);
      toast.success(i18n.t("settings.orderFields.toast.deleted"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useResetSystemOrderFieldOverride() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (fieldKey: string) => {
      guardWrite();
      return resetSystemOrderFieldOverride(workspaceId, fieldKey);
    },
    onSuccess: () => invalidateOrderFieldConfig(queryClient, workspaceId),
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useResetAllSystemOrderFieldOverrides() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: () => {
      guardWrite();
      return resetAllSystemOrderFieldOverrides(workspaceId);
    },
    onSuccess: () => {
      invalidateOrderFieldConfig(queryClient, workspaceId);
      toast.success(i18n.t("settings.orderFields.toast.resetAll"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useSaveOrderCustomFieldValues() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; values: Array<{ definitionId: string; value: unknown }> }) => {
      guardWrite();
      return upsertCustomFieldValues(workspaceId, input.orderId, input.values);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["custom-field-values", workspaceId, vars.orderId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("settings.orderFields.errors.valueSaveFailed"));
    },
  });
}

/** Lookup helper for components that only need one field's label/visibility. */
export function fieldConfigMap(fields: OrderFieldConfigItem[]): Map<string, OrderFieldConfigItem> {
  return new Map(fields.map((field) => [field.key, field]));
}
