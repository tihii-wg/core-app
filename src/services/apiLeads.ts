import i18n from "../i18n";
import {
  deleteStage9Row,
  insertStage9Row,
  listStage9Rows,
  nullIfBlank,
  resolveDefaultStatusId,
  str,
} from "./apiStage9List";

export type LeadRecord = {
  id: string;
  number: string | null;
  leadType: "inquiry" | "missed_call";
  contactName: string | null;
  phone: string | null;
  statusId: string | null;
  isUrgent: boolean;
  createdAt: string;
};

const leadColumns = "id, number, lead_type, contact_name, phone, status_id, is_urgent, created_at";

export function toLead(row: Record<string, unknown>): LeadRecord {
  return {
    id: String(row.id),
    number: str(row.number),
    leadType: row.lead_type === "missed_call" ? "missed_call" : "inquiry",
    contactName: str(row.contact_name),
    phone: str(row.phone),
    statusId: str(row.status_id),
    isUrgent: row.is_urgent === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Lists leads, newest first. Resolves to `isUnavailable` when the `leads` table is not applied. */
export function getLeads(workspaceId: string | undefined) {
  return listStage9Rows("leads", leadColumns, workspaceId, "created_at", false, toLead);
}

export type LeadInput = {
  contactName: string;
  phone: string;
  leadType: LeadRecord["leadType"];
  isUrgent: boolean;
};

const MAX_LEAD_TEXT = 200;

/** Validates a lead form and builds the insert row (without workspace/status). Pure. */
export function buildLeadRow(input: LeadInput) {
  const contactName = nullIfBlank(input.contactName);
  const phone = nullIfBlank(input.phone);
  if (!contactName && !phone) throw new Error(i18n.t("stage9.leads.errors.contactRequired"));
  if ((contactName?.length ?? 0) > MAX_LEAD_TEXT || (phone?.length ?? 0) > 40) {
    throw new Error(i18n.t("stage9.leads.errors.tooLong"));
  }
  return {
    lead_type: input.leadType === "missed_call" ? "missed_call" : "inquiry",
    contact_name: contactName,
    phone,
    is_urgent: Boolean(input.isUrgent),
  };
}

export async function createLead(input: LeadInput, workspaceId: string | undefined) {
  const row = buildLeadRow(input);
  const statusId = await resolveDefaultStatusId("lead", workspaceId);
  return insertStage9Row("leads", statusId ? { ...row, status_id: statusId } : row, workspaceId);
}

/** Soft-deletes a lead (`deleted_at`). */
export function deleteLead(id: string, workspaceId: string | undefined) {
  return deleteStage9Row("leads", id, workspaceId);
}
