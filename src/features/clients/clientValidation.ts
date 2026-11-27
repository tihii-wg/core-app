import i18n from "../../i18n";
import { INTERNATIONAL_PHONE_PATTERN, normalizePhoneInput } from "../../lib/phoneFormat";

export const clientTypeRules = () => ({ required: i18n.t("clients.validation.typeRequired") });

export const clientPhoneRules = () => ({
  required: i18n.t("clients.validation.phoneRequired"),
  // Any country code; spaces / dashes / brackets are stripped before validation and saving.
  setValueAs: normalizePhoneInput,
  pattern: {
    value: INTERNATIONAL_PHONE_PATTERN,
    message: i18n.t("clients.validation.phoneFormat"),
  },
});
