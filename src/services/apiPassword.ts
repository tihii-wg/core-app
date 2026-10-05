import supabase from "./supabase";
import i18n from "../i18n";
import { passwordChangeMessage, passwordMinimum } from "./authMessages";

type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

async function assertCurrentPassword(email: string, password: string) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let response: Response;

  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error(i18n.t("auth.password.errors.changeFailed"));
  }

  if (response.status === 400) throw new Error(i18n.t("auth.password.errors.currentIncorrect"));
  if (!response.ok) throw new Error(i18n.t("auth.password.errors.changeFailed"));
}

export async function changePassword({ currentPassword, newPassword }: PasswordChangeInput) {
  if (newPassword.length < passwordMinimum) throw new Error(passwordChangeMessage("password should be at least 6 characters"));

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) throw new Error(i18n.t("auth.errors.sessionExpired"));

  await assertCurrentPassword(user.email, currentPassword);

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(passwordChangeMessage(error.message));
}
