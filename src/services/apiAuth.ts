import supabase from "./supabase";
import i18n, { currentLanguage } from "../i18n";
import { resolveIndustryId } from "./apiIndustries";
import { normalizeWorkspaceDateFormat, normalizeWorkspaceLanguage } from "./apiWorkspaces";

export function isInvalidSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const details = error as { message?: string; status?: number };
  const message = (details.message ?? "").toLowerCase();
  const mentionsCredential = message.includes("jwt") || message.includes("refresh token") || message.includes("session expired") || message.includes("auth session missing") || message.includes("invalid claim");

  return mentionsCredential;
}

type signUpProps = {
  companyName: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
  industryId: string;
};

type loginProps = {
  email: string;
  password: string;
};

export async function signUp(data: signUpProps) {
  // 1.AUTH USER
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        phone: data.phone,
        companyName: data.companyName,
        ownerName: data.ownerName,
      },
    },
  });

  if (authError) {
    console.log(`Auth error --${authError.message}`);
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) throw new Error(i18n.t("auth.errors.userNotFound"));

  const industryId = await resolveIndustryId(data.industryId);

  const { ownerName, phone, companyName } = user.user_metadata ?? {};

  // 2.PROFILE
  const { error: profileError } = await supabase.from("profiles").insert([
    {
      id: user.id,
      full_name: ownerName,
      email: user.email,
      phone: phone,
      active_workspace_id: null,
    },
  ]);

  if (profileError) throw new Error(profileError.message);

  // 3.WORKSPACE
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert([
      {
        name: companyName,
        owner_id: user.id,
        industry_id: industryId,
        language: normalizeWorkspaceLanguage(currentLanguage()),
        date_format: normalizeWorkspaceDateFormat("DD.MM.YYYY"),
      },
    ])
    .select()
    .single();

  if (workspaceError) throw new Error(workspaceError.message);

  // 4.WORKSPACE MEMBER

  const { error: memberError } = await supabase.from("workspace_members").insert([
    {
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner",
    },
  ]);

  if (memberError) throw new Error(memberError.message);

  //5 set active workspace

  const { error: profilersError } = await supabase.from("profiles").update({ active_workspace_id: workspace.id }).eq("id", user.id).select();

  if (profilersError) throw new Error(profilersError.message);

  return { user, workspace };
}

export async function getCurrentUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) return null;

  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;

  if (error && isInvalidSessionError(error)) {
    await supabase.auth.signOut();
    return null;
  }

  return sessionData.session.user;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function FogotPasword() {
  console.log("fogot password");
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
