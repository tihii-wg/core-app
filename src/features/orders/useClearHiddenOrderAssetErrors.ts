import { useEffect } from "react";
import type { IndustryWorkflow, OrderAssetFieldName } from "../industries/industryWorkflow";
import { hiddenOrderAssetFields } from "../industries/industryWorkflow";

/** Drop stale RHF errors for fields that the active industry no longer shows. */
export function useClearHiddenOrderAssetErrors(workflow: IndustryWorkflow, clearErrors: (name?: OrderAssetFieldName | OrderAssetFieldName[]) => void) {
  const hiddenKey = hiddenOrderAssetFields(workflow).join(",");

  useEffect(() => {
    if (!hiddenKey) return;
    clearErrors(hiddenKey.split(",") as OrderAssetFieldName[]);
  }, [hiddenKey, clearErrors]);
}
