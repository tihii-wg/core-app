import i18n from "../i18n";

const passwordMinimum = 6;

export function sessionNeedsMfa(level: { currentLevel: string | null; nextLevel: string | null } | null) {
  return level?.currentLevel === "aal1" && level?.nextLevel === "aal2";
}

export function formatSetupKey(secret: string) {
  return secret.replace(/\s/g, "").match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function totpQrSrc(qrCode: string) {
  if (qrCode.startsWith("data:")) return qrCode;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
}

export function passwordChangeMessage(message: string) {
  const text = message.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid credentials") || text.includes("current password")) {
    return i18n.t("auth.password.errors.currentIncorrect");
  }
  if (text.includes("at least") || text.includes("weak") || text.includes("password should")) {
    return i18n.t("auth.password.errors.tooShort", { count: passwordMinimum });
  }
  if (text.includes("different")) {
    return i18n.t("auth.password.errors.sameAsCurrent");
  }
  if (text.includes("session") || text.includes("not authenticated") || text.includes("jwt")) {
    return i18n.t("auth.errors.sessionExpired");
  }
  return i18n.t("auth.password.errors.changeFailed");
}

export function mfaVerifyMessage(message: string) {
  const text = message.toLowerCase();
  if (text.includes("expired")) return i18n.t("auth.mfa.errors.codeExpired");
  return i18n.t("auth.mfa.errors.invalidCode");
}

export { passwordMinimum };
