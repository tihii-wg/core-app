import type en from "../en/onboarding";
import type { Messages } from "../../types";

const onboarding: Messages<typeof en> = {
  title: "Расскажите о вашем бизнесе",
  description: "Выберите тип бизнеса. Мы используем его, чтобы настроить рабочее пространство.",
  loading: "Загрузка типов бизнеса...",
  empty: "Сейчас нет доступных типов бизнеса.",
  loadFailed: "Не удалось загрузить типы бизнеса.",
  errors: {
    saveFailed: "Не удалось сохранить тип бизнеса. Попробуйте ещё раз.",
  },
};

export default onboarding;
