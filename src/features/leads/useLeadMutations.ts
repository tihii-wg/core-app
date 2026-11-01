import i18n from "../../i18n";
import { createLead, deleteLead, type LeadInput } from "../../services/apiLeads";
import { useStage9Mutation } from "../stage9/useStage9Mutation";

export function useCreateLead() {
  return useStage9Mutation<LeadInput>("leads", (input, ws) => createLead(input, ws), () => i18n.t("stage9.leads.toast.created"));
}

export function useDeleteLead() {
  return useStage9Mutation<string>("leads", (id, ws) => deleteLead(id, ws), () => i18n.t("stage9.leads.toast.deleted"));
}
