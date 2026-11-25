import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  getFormFieldOverrides,
  saveFormFieldOverrides,
  type AllFormFieldOverrides,
} from "../../services/apiFormFields";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { resolveFormFields, type FormEntity, type FormFieldOverrides, type ResolvedFormField } from "./formFieldRegistry";

export function formFieldsQueryKey(workspaceId: string | undefined) {
  return ["form-fields", workspaceId] as const;
}

/** Overrides of every configurable form — one request per workspace, cached (settings change rarely). */
export function useFormFieldOverrides() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: formFieldsQueryKey(workspaceId),
    queryFn: () => getFormFieldOverrides(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });
}

export type FormFieldLayout = {
  fields: ResolvedFormField[];
  /** Workspace label, or the form's own default text. */
  label: (key: string, fallback: string) => string;
  visible: (key: string) => boolean;
  /** Puts keyed blocks into the configured order and drops hidden ones (unknown keys keep their place at the end). */
  arrange: <T extends { key: string }>(blocks: readonly T[]) => T[];
};

/** Field layout of one form: labels, visibility and order (defaults until the settings load). */
export function useFormFieldLayout(entity: FormEntity): FormFieldLayout {
  const { data } = useFormFieldOverrides();
  const overrides = data?.[entity];
  const fields = useMemo(() => resolveFormFields(entity, overrides), [entity, overrides]);
  const byKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const label = useCallback((key: string, fallback: string) => byKey.get(key)?.customLabel ?? fallback, [byKey]);
  const visible = useCallback((key: string) => byKey.get(key)?.visible ?? true, [byKey]);
  const arrange = useCallback(
    <T extends { key: string }>(blocks: readonly T[]) => {
      const position = new Map(blocks.map((block, index) => [block.key, index]));
      const rank = (key: string) => byKey.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
      return blocks
        .filter((block) => byKey.get(block.key)?.visible ?? true)
        .sort((a, b) => rank(a.key) - rank(b.key) || (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0));
    },
    [byKey],
  );
  return useMemo(() => ({ fields, label, visible, arrange }), [fields, label, visible, arrange]);
}

/** Saves one form's overrides: optimistic cache update, one upsert, rollback on error. */
export function useSaveFormFieldOverrides() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  const key = formFieldsQueryKey(workspaceId);

  return useMutation({
    mutationFn: ({ entity, overrides }: { entity: FormEntity; overrides: FormFieldOverrides }) => {
      guardWrite();
      return saveFormFieldOverrides(workspaceId, entity, overrides);
    },
    onMutate: async ({ entity, overrides }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AllFormFieldOverrides>(key);
      queryClient.setQueryData<AllFormFieldOverrides>(key, (current) => ({
        client: {},
        service: {},
        product: {},
        ...(current ?? {}),
        [entity]: overrides,
      }));
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}
