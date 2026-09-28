import supabase from "./supabase";

export type ProfileTheme = "light" | "dark" | "system";

export type ProfileRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  active_workspace_id: string | null;
  theme: ProfileTheme;
};

export type UpdateProfileInput = {
  fullName: string;
  phone: string;
};

const phonePattern = /^\+[1-9]\d{7,14}$/;
const profileColumns = "id, full_name, email, phone, active_workspace_id, theme";
const profileColumnsWithoutTheme = "id, full_name, email, phone, active_workspace_id";

export function normalizeProfileTheme(value: unknown): ProfileTheme {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyProfileTheme(theme: ProfileTheme, prefersDark: boolean) {
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

function isMissingThemeColumn(error: { code?: string; message?: string }) {
  return (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("theme") === true;
}

export function toProfile(row: unknown): ProfileRecord {
  if (!row || typeof row !== "object") throw new Error("Profile not found");

  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) throw new Error("Profile not found");

  return {
    id: record.id,
    full_name: typeof record.full_name === "string" ? record.full_name : null,
    email: typeof record.email === "string" ? record.email : null,
    phone: typeof record.phone === "string" ? record.phone : null,
    active_workspace_id: typeof record.active_workspace_id === "string" ? record.active_workspace_id : null,
    theme: normalizeProfileTheme(record.theme),
  };
}

export function profileUpdateFields(input: UpdateProfileInput) {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Full name is required");

  const phone = input.phone.trim();
  if (phone && !phonePattern.test(phone)) {
    throw new Error("Phone must be in international format, such as +37300000000");
  }

  return {
    full_name: fullName,
    phone: phone || null,
  };
}

async function currentUserId() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  return user.id;
}

async function readProfileRow(userId: string) {
  let result = await supabase.from("profiles").select(profileColumns).eq("id", userId).maybeSingle();
  if (result.error && isMissingThemeColumn(result.error)) {
    result = await supabase.from("profiles").select(profileColumnsWithoutTheme).eq("id", userId).maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function updateProfileRow(userId: string, fields: Record<string, string | null>) {
  let result = await supabase.from("profiles").update(fields).eq("id", userId).select(profileColumns).maybeSingle();
  if (result.error && isMissingThemeColumn(result.error)) {
    result = await supabase.from("profiles").update(fields).eq("id", userId).select(profileColumnsWithoutTheme).maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Profile could not be updated.");
  return toProfile(result.data);
}

export async function getProfile() {
  const userId = await currentUserId();
  const data = await readProfileRow(userId);
  if (!data) return null;
  return toProfile(data);
}

export async function updateProfile(input: UpdateProfileInput) {
  const userId = await currentUserId();
  return updateProfileRow(userId, profileUpdateFields(input));
}

export async function updateProfileTheme(theme: ProfileTheme) {
  const userId = await currentUserId();
  return updateProfileRow(userId, { theme: normalizeProfileTheme(theme) });
}
