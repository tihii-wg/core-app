import supabase from "./supabase";

export type ProfileRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  active_workspace_id: string | null;
};

export type UpdateProfileInput = {
  fullName: string;
  phone: string;
};

const phonePattern = /^\+[1-9]\d{7,14}$/;

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

export async function getProfile() {
  const userId = await currentUserId();
  const { data, error } = await supabase.from("profiles").select("id, full_name, email, phone, active_workspace_id").eq("id", userId).maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return toProfile(data);
}

export async function updateProfile(input: UpdateProfileInput) {
  const userId = await currentUserId();
  const fields = profileUpdateFields(input);

  const { data, error } = await supabase.from("profiles").update(fields).eq("id", userId).select("id, full_name, email, phone, active_workspace_id").maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Profile could not be updated.");

  return toProfile(data);
}
