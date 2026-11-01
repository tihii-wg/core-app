import i18n from "../../i18n";
import { createEstimate, deleteEstimate, type EstimateInput } from "../../services/apiEstimates";
import { useStage9Mutation } from "../stage9/useStage9Mutation";

export function useCreateEstimate() {
  return useStage9Mutation<EstimateInput>("estimates", (input, ws) => createEstimate(input, ws), () => i18n.t("stage9.estimates.toast.created"));
}

export function useDeleteEstimate() {
  return useStage9Mutation<string>("estimates", (id, ws) => deleteEstimate(id, ws), () => i18n.t("stage9.estimates.toast.deleted"));
}
