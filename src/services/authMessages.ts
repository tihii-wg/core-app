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
    return "Current password is incorrect.";
  }
  if (text.includes("at least") || text.includes("weak") || text.includes("password should")) {
    return `Password must be at least ${passwordMinimum} characters.`;
  }
  if (text.includes("different")) {
    return "Choose a password that is different from your current password.";
  }
  if (text.includes("session") || text.includes("not authenticated") || text.includes("jwt")) {
    return "Your session has expired. Please sign in again.";
  }
  return "Unable to change password. Please try again.";
}

export function mfaVerifyMessage(message: string) {
  const text = message.toLowerCase();
  if (text.includes("expired")) return "The verification code expired. Enter the current code from your authenticator app.";
  return "Invalid verification code.";
}

export { passwordMinimum };
