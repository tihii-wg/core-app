import type { AppLanguage } from "../i18n/languages";
import { fallbackLanguage, isAppLanguage } from "../i18n/languages";

export type WarrantyStart = "created_at" | "closed_at";
export type VisibilityDefault = "public" | "private";
export type InvoiceOrderDetailsMode = "detailed" | "simplified" | "one_line";

export type WorkspaceCompanyFields = {
  companyAddress: string;
  billingEmail: string;
  registrationNumber: string;
  taxVatNumber: string;
  iban: string;
  bankName: string;
  bankCode: string;
  companyDescription: string;
  printExtraInfo: string;
};

export type WorkspaceRegionalExtra = {
  countryCode: string;
  documentLanguage: AppLanguage;
};

export type WorkspaceOrderSettings = {
  warrantyStart: WarrantyStart;
  defaultCommentsVisibility: VisibilityDefault;
  defaultFilesVisibility: VisibilityDefault;
  preventDuplicateDeviceOrders: boolean;
};

export type WorkspaceContactSettings = {
  showClientMiddleName: boolean;
  defaultPhoneConsent: boolean;
  preventDuplicatePhones: boolean;
  defaultEmailConsent: boolean;
  preventDuplicateEmails: boolean;
};

export type WorkspaceInvoiceSettings = {
  invoiceNumberTemplate: string;
  invoiceDueDays: number;
  invoiceOrderDetailsMode: InvoiceOrderDetailsMode;
  preventBackdatedInvoices: boolean;
  defaultLegalEntityId: string | null;
};

export const companyFieldDefaults: WorkspaceCompanyFields = {
  companyAddress: "",
  billingEmail: "",
  registrationNumber: "",
  taxVatNumber: "",
  iban: "",
  bankName: "",
  bankCode: "",
  companyDescription: "",
  printExtraInfo: "",
};

export const orderSettingsDefaults: WorkspaceOrderSettings = {
  warrantyStart: "created_at",
  defaultCommentsVisibility: "private",
  defaultFilesVisibility: "private",
  preventDuplicateDeviceOrders: false,
};

export const contactSettingsDefaults: WorkspaceContactSettings = {
  showClientMiddleName: false,
  defaultPhoneConsent: false,
  preventDuplicatePhones: false,
  defaultEmailConsent: false,
  preventDuplicateEmails: false,
};

export const invoiceSettingsDefaults: WorkspaceInvoiceSettings = {
  invoiceNumberTemplate: "INV-{YYYY}-{###}",
  invoiceDueDays: 14,
  invoiceOrderDetailsMode: "detailed",
  preventBackdatedInvoices: true,
  defaultLegalEntityId: null,
};

export const countryOptions = [
  { value: "MD", labelKey: "settings.general.regional.countries.md" },
  { value: "RO", labelKey: "settings.general.regional.countries.ro" },
  { value: "UA", labelKey: "settings.general.regional.countries.ua" },
  { value: "US", labelKey: "settings.general.regional.countries.us" },
  { value: "GB", labelKey: "settings.general.regional.countries.gb" },
  { value: "DE", labelKey: "settings.general.regional.countries.de" },
  { value: "OTHER", labelKey: "settings.general.regional.countries.other" },
] as const;

export function normalizeDocumentLanguage(value: string | null | undefined): AppLanguage {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isAppLanguage(code) ? code : fallbackLanguage;
}

export function normalizeWarrantyStart(value: string | null | undefined): WarrantyStart {
  return value === "closed_at" ? "closed_at" : "created_at";
}

export function normalizeVisibility(value: string | null | undefined): VisibilityDefault {
  return value === "public" ? "public" : "private";
}

export function normalizeInvoiceOrderDetailsMode(value: string | null | undefined): InvoiceOrderDetailsMode {
  if (value === "simplified" || value === "one_line") return value;
  return "detailed";
}

/** Must stay aligned with public.invoice_number_template_is_valid in the General Settings SQL. */
export function isValidInvoiceNumberTemplate(value: string | null | undefined) {
  const template = value?.trim() ?? "";
  // Exactly one {YYYY}, exactly one {###+} (3+ hashes), literal INV- prefix; no other braces.
  return /^INV-\{YYYY\}-\{#{3,}\}$/.test(template);
}

export function normalizeInvoiceNumberTemplate(value: string | null | undefined) {
  const template = value?.trim() || invoiceSettingsDefaults.invoiceNumberTemplate;
  return isValidInvoiceNumberTemplate(template) ? template : invoiceSettingsDefaults.invoiceNumberTemplate;
}

export function normalizeInvoiceDueDays(value: unknown) {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days)) return invoiceSettingsDefaults.invoiceDueDays;
  return Math.min(3650, Math.max(0, Math.round(days)));
}
