import type en from "../en/workspaces";
import type { Messages } from "../../types";

const workspaces: Messages<typeof en> = {
  create: {
    nameLabel: "Компания *",
    namePlaceholder: "Компания",
    nameRequired: "Укажите название",
    businessTypeLabel: "Тип бизнеса *",
    businessTypePlaceholder: "Тип бизнеса",
    businessTypeRequired: "Выберите тип бизнеса",
    roleLabel: "Роль *",
    rolePlaceholder: "Роль",
    roleRequired: "Укажите роль",
    submit: "Добавить компанию",
  },
  toast: {
    created: "Компания создана!",
    createFailed: "Не удалось создать компанию",
    switching: "Переключение...",
    switched: "Компания переключена",
    switchFailed: "Не удалось переключить компанию",
  },
  redirect: {
    noWorkspaces: "Вы пока не состоите ни в одной компании.",
  },
  errors: {
    noAccess: "У вас нет доступа к этой компании",
    industryNotFound: "Выбранный тип бизнеса не найден",
  },
  industries: {
    auto_repair: "Автосервис и ремонт",
    phone_electronics_repair: "Ремонт телефонов и электроники",
    computer_repair: "Ремонт компьютеров",
    appliance_repair: "Ремонт бытовой техники",
    equipment_repair: "Ремонт оборудования",
    electrical_services: "Электромонтажные услуги",
    home_services: "Бытовые услуги",
    other: "Другое",
  },
  industryPresets: {
    restaurant: {
      label: "Рестораны и кафе",
      hint: "Для заведений с меню, бронированиями и повторными визитами.",
    },
    beauty: {
      label: "Салоны красоты",
      hint: "Подходит для записей, мастеров и программ лояльности.",
    },
    fitness: {
      label: "Фитнес и спорт",
      hint: "Для абонементов, тренировок и удержания клиентов.",
    },
    medical: {
      label: "Медицина",
      hint: "Для клиник, приемов и аккуратной работы с пациентами.",
    },
    retail: {
      label: "Розница",
      hint: "Для витрин, заказов и управления ассортиментом.",
    },
    professional_services: {
      label: "Профессиональные услуги",
      hint: "Для агентств, консультантов и сервисных команд.",
    },
    auto_service: {
      label: "Автосервис",
      hint: "Для диагностики, ремонта и записи на обслуживание.",
    },
    electronics_repair: {
      label: "Ремонт электроники",
      hint: "Для мастерских, заявок и отслеживания статусов ремонта.",
    },
  },
  logo: {
    errors: {
      invalidFile: "Выберите изображение JPG, PNG или WebP размером до 5 МБ.",
      uploadFailed: "Не удалось загрузить логотип компании. Попробуйте ещё раз.",
      removeFailed: "Не удалось удалить логотип компании. Попробуйте ещё раз.",
      loadFailed: "Не удалось загрузить логотип компании. Попробуйте ещё раз.",
      invalidWorkspaceId: "Неверный идентификатор компании",
      noRowReturned: "Не удалось обновить логотип: запись не возвращена",
      cropEmpty: "Область обрезки пуста",
      canvasUnavailable: "Canvas недоступен",
      webpConversionFailed: "Не удалось преобразовать изображение в WebP",
      signedUrlEmpty: "Подписанная ссылка пуста",
      invalidLogoPath: "Неверный путь к логотипу",
      imageUnreadable: "Не удалось прочитать изображение",
    },
  },
};

export default workspaces;
