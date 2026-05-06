export type IndustryKey =
  | "restaurant"
  | "beauty"
  | "fitness"
  | "medical"
  | "retail"
  | "professional_services"
  | "auto_service"
  | "electronics_repair";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  preferredLanguage?: string;
};

export type Company = {
  id: string;
  ownerUserId: string;
  name: string | null;
  industry: IndustryKey;
};
