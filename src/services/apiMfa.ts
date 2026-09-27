import supabase from "./supabase";
import { mfaVerifyMessage } from "./authMessages";

const authenticatorName = "Core App Authenticator";

export type MfaAssurance = {
  currentLevel: string | null;
  nextLevel: string | null;
};

export type MfaStatus = MfaAssurance & {
  enabled: boolean;
  factorId: string | null;
};

export type TotpEnrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export async function getMfaAssurance(): Promise<MfaAssurance> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error("Unable to check two-factor authentication. Please try again.");

  return {
    currentLevel: data?.currentLevel ?? null,
    nextLevel: data?.nextLevel ?? null,
  };
}

export async function getMfaStatus(): Promise<MfaStatus> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error("Unable to load two-factor authentication. Please try again.");

  const verified = data?.totp?.[0] ?? null;
  const assurance = await getMfaAssurance();

  return {
    enabled: Boolean(verified),
    factorId: verified?.id ?? null,
    ...assurance,
  };
}

export async function verifiedTotpFactorId() {
  const status = await getMfaStatus();
  return status.factorId;
}

async function removeUnverifiedTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return;

  const unverified = data.all.filter((factor) => factor.factor_type === "totp" && factor.status === "unverified");
  await Promise.all(unverified.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  const status = await getMfaStatus();
  if (status.enabled) throw new Error("Two-factor authentication is already enabled.");

  await removeUnverifiedTotpFactors();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: authenticatorName,
  });

  if (error || !data?.totp) throw new Error("Unable to start two-factor setup. Please try again.");

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function cancelTotpEnrollment(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error("Unable to cancel two-factor setup. Please try again.");
}

export async function verifyTotp(factorId: string, code: string) {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) throw new Error("Invalid verification code.");

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) throw new Error(mfaVerifyMessage(challengeError?.message ?? "expired"));

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: normalized,
  });

  if (error || !data?.user) throw new Error(mfaVerifyMessage(error?.message ?? "invalid"));
  return data.user;
}

export async function disableTotp(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error("Unable to disable two-factor authentication. Please try again.");
}
