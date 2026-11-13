import type { User } from "@supabase/supabase-js";
import supabase from "./supabase";
import i18n, { currentLanguage } from "../i18n";
import { normalizeWorkspaceDateFormat, normalizeWorkspaceLanguage } from "./apiWorkspaces";
import {
  clearPasswordRecoveryFlag,
  isConfirmedRecoveryForUser,
  normalizeRecoveryLocale,
  passwordResetRedirectUrl,
} from "../features/auth/passwordRecovery";
import { passwordChangeMessage, passwordMinimum, passwordResetRequestMessage } from "./authMessages";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { passwordResetPath, passwordResetRedirectUrl } from "../features/auth/passwordRecovery";

export type SignUpMode = "create" | "join";

export function isInvalidSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const details = error as { message?: string; status?: number };
  const message = (details.message ?? "").toLowerCase();
  const mentionsCredential = message.includes("jwt") || message.includes("refresh token") || message.includes("session expired") || message.includes("auth session missing") || message.includes("invalid claim");

  return mentionsCredential;
}

export type SignUpProps = {
  mode?: SignUpMode;
  companyName?: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
};

export type SignUpResult = {
  user: User;
  workspace: { id: string } | null;
  needsEmailConfirmation: boolean;
  mode: SignUpMode;
};

type loginProps = {
  email: string;
  password: string;
};

function normalizeSignUpMode(value: unknown): SignUpMode {
  return value === "join" ? "join" : "create";
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? "");
}

async function insertProfileForUser(user: User, meta: Record<string, unknown>) {
  const fullName = metaString(meta, "ownerName") || metaString(meta, "full_name") || user.email || "";
  const phone = metaString(meta, "phone") || null;
  const { error } = await supabase.from("profiles").insert([
    {
      id: user.id,
      full_name: fullName || null,
      email: user.email,
      phone,
      active_workspace_id: null,
    },
  ]);
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

async function createOwnedWorkspaceForUser(user: User, companyName: string) {
  const name = companyName.trim();
  if (!name) throw new Error(i18n.t("auth.register.companyNameRequired"));

  const { data: existingOwned, error: ownedError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (existingOwned?.id) {
    await ensureOwnerMembership(user.id, existingOwned.id);
    await supabase.from("profiles").update({ active_workspace_id: existingOwned.id }).eq("id", user.id);
    return { id: String(existingOwned.id) };
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert([
      {
        name,
        owner_id: user.id,
        industry_id: null,
        language: normalizeWorkspaceLanguage(currentLanguage()),
        date_format: normalizeWorkspaceDateFormat("DD.MM.YYYY"),
      },
    ])
    .select("id")
    .single();

  if (workspaceError) throw new Error(workspaceError.message);

  await ensureOwnerMembership(user.id, workspace.id);

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ active_workspace_id: workspace.id })
    .eq("id", user.id);
  if (profileError) throw new Error(profileError.message);

  return { id: String(workspace.id) };
}

async function ensureOwnerMembership(userId: string, workspaceId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("workspace_members")
    .select("user_id, deleted_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing && !existing.deleted_at) return;
  if (existing?.deleted_at) {
    const { error } = await supabase
      .from("workspace_members")
      .update({ role: "owner", deleted_at: null })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("workspace_members").insert([
    {
      workspace_id: workspaceId,
      user_id: userId,
      role: "owner",
    },
  ]);
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

/**
 * After email confirmation (or any first login without a profile row), create the
 * profile from auth metadata. Own-workspace mode also creates the workspace +
 * owner membership. Join mode never auto-creates a workspace. Idempotent.
 */
export async function ensureSignupBootstrap(user: User): Promise<{ workspace: { id: string } | null; mode: SignUpMode }> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const mode = normalizeSignUpMode(meta.signup_mode);

  const { data: profile, error: profileReadError } = await supabase
    .from("profiles")
    .select("id, active_workspace_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileReadError) throw new Error(profileReadError.message);

  if (!profile) {
    await insertProfileForUser(user, meta);
  }

  if (mode === "join") {
    return { workspace: null, mode };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (membership?.workspace_id) {
    if (!profile?.active_workspace_id) {
      await supabase.from("profiles").update({ active_workspace_id: membership.workspace_id }).eq("id", user.id);
    }
    return { workspace: { id: String(membership.workspace_id) }, mode };
  }

  // Only the very first bootstrap (profile row did not exist yet) may create a workspace.
  // Never recreate a workspace for an existing user who deleted it or left every team.
  if (profile) {
    return { workspace: null, mode };
  }

  const companyName = metaString(meta, "companyName");
  if (!companyName) {
    // Legacy / incomplete metadata: do not invent a workspace.
    return { workspace: null, mode };
  }

  const workspace = await createOwnedWorkspaceForUser(user, companyName);
  return { workspace, mode };
}

export async function signUp(data: SignUpProps): Promise<SignUpResult> {
  const mode = data.mode === "join" ? "join" : "create";
  const companyName = (data.companyName ?? "").trim();
  if (mode === "create" && !companyName) {
    throw new Error(i18n.t("auth.register.companyNameRequired"));
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        phone: data.phone?.trim() || "",
        companyName: mode === "create" ? companyName : "",
        ownerName: data.ownerName.trim(),
        signup_mode: mode,
      },
    },
  });

  if (authError) {
    console.log(`Auth error --${authError.message}`);
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) throw new Error(i18n.t("auth.errors.userNotFound"));

  // Email confirmation is on: there is no session yet, so profile and workspace writes are rejected.
  if (!authData.session) {
    return { user, workspace: null, needsEmailConfirmation: true, mode };
  }

  const bootstrapped = await ensureSignupBootstrap(user);
  return {
    user,
    workspace: bootstrapped.workspace,
    needsEmailConfirmation: false,
    mode: bootstrapped.mode,
  };
}

export async function getCurrentUser() {
  // Local session only — avoids /auth/v1/user on every mount. AuthSession keeps
  // ["user"] in sync on SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED. Sensitive
  // mutations still call supabase.auth.getUser() where a server check is required.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.user) return null;
  return sessionData.session.user;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

/**
 * Requests a Supabase Auth password recovery email.
 * Always resolves the same way to callers after a successful Auth response — UI must not
 * reveal whether the address is registered (Auth also avoids leaking that).
 */
export async function requestPasswordReset(email: string, locale: string) {
  const trimmed = email.trim();
  if (!trimmed) throw new Error(i18n.t("auth.validation.emailRequired"));
  if (!EMAIL_PATTERN.test(trimmed)) throw new Error(i18n.t("auth.validation.emailInvalid"));

  const safeLocale = normalizeRecoveryLocale(locale);
  const redirectTo = passwordResetRedirectUrl(safeLocale);

  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo,
  });

  if (error) throw new Error(passwordResetRequestMessage(error.message));
}

/**
 * Sets a new password only during a confirmed password-recovery flow.
 * Requires both an Auth session and a recovery marker bound to that user
 * (set only after Supabase `PASSWORD_RECOVERY`).
 */
export async function updateRecoveredPassword(password: string) {
  if (password.length < passwordMinimum) {
    throw new Error(passwordChangeMessage("password should be at least 6 characters"));
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.user?.id) {
    throw new Error(i18n.t("auth.resetPassword.errors.noSession"));
  }

  if (!isConfirmedRecoveryForUser(session.user.id)) {
    throw new Error(i18n.t("auth.resetPassword.errors.noSession"));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(passwordChangeMessage(error.message));
}

/**
 * Ends the recovery session after a successful password update (user must sign in again).
 * Uses default global sign-out so recovery invalidates refresh tokens across devices.
 */
export async function endPasswordRecoverySession() {
  clearPasswordRecoveryFlag();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function login({ email, password }: loginProps) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) throw new Error(i18n.t("auth.errors.invalidCredentials"));

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) {
    await supabase.auth.signOut();
    throw new Error(i18n.t("auth.mfa.errors.checkFailed"));
  }

  const mfaRequired = assurance?.currentLevel === "aal1" && assurance?.nextLevel === "aal2";
  if (!mfaRequired) return { user: data.user, mfaRequired: false, factorId: null };

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.totp?.[0]?.id ?? null;
  if (factorsError || !factorId) {
    await supabase.auth.signOut();
    throw new Error(i18n.t("auth.mfa.errors.startVerificationFailed"));
  }

  return { user: data.user, mfaRequired: true, factorId };
}

/** Registration URL for people invited to join an existing workspace (no own company). */
export function joinTeamRegisterUrl(locale: string, email: string, origin?: string) {
  const base =
    origin ??
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");
  const params = new URLSearchParams({ mode: "join" });
  const trimmed = email.trim();
  if (trimmed) params.set("email", trimmed);
  return `${base}/${locale}/register?${params.toString()}`;
}
