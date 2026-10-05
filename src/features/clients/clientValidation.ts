import i18n from "../../i18n";

export const clientTypeRules = () => ({ required: i18n.t("clients.validation.typeRequired") });

export const clientEmailRules = () => ({ required: i18n.t("clients.validation.emailRequired") });

export const clientPhoneRules = () => ({
  required: i18n.t("clients.validation.phoneRequired"),
  pattern: {
    value: /^\+373\d{8}$/,
    message: i18n.t("clients.validation.phoneFormat"),
  },
});
