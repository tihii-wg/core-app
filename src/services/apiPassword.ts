import { createClient } from "@supabase/supabase-js";
import supabase from "./supabase";
import { passwordChangeMessage, passwordMinimum } from "./authMessages";

type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

async function assertCurrentPassword(email: string, password: string) {
  const checker = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "core-app-password-check",
      storage: memoryStorage,
    },
  });

  const { error } = await checker.auth.signInWithPassword({ email, password });
  if (error) throw new Error(passwordChangeMessage(error.message));
}

export async function changePassword({ currentPassword, newPassword }: PasswordChangeInput) {
  if (newPassword.length < passwordMinimum) throw new Error(passwordChangeMessage("password should be at least 6 characters"));

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) throw new Error("Your session has expired. Please sign in again.");

  await assertCurrentPassword(user.email, currentPassword);

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(passwordChangeMessage(error.message));
}
