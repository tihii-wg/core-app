import { useTranslation } from "react-i18next";

export default function Account() {
  const { t } = useTranslation();
  return <div>{t("auth.placeholders.account")}</div>;
}
