import type en from "../en/clients";
import type { Messages } from "../../types";

const clients: Messages<typeof en> = {
  title: "Клиенты",
  loading: "Загрузка клиентов...",
  totalCount_one: "Всего {{count}} клиент",
  totalCount_few: "Всего {{count}} клиента",
  totalCount_many: "Всего {{count}} клиентов",
  totalCount_other: "Всего {{count}} клиента",
  addClient: "Добавить клиента",
  searchPlaceholder: "Поиск по имени, налоговому коду, контактному лицу, email, телефону или адресу...",
  editClientLabel: "Редактировать {{name}}",
  types: {
    individual: "Физическое лицо",
    organization: "Юридическое лицо",
  },
  filters: {
    clientType: "Тип клиента",
    individuals: "Физические лица",
    organizations: "Юридические лица",
  },
  table: {
    name: "Имя",
    clientType: "Тип клиента",
    contact: "Контакты",
    orders: "Заказы",
    balance: "Баланс",
    added: "Добавлен",
  },
  addDialog: {
    title: "Новый клиент",
    description: "Заполните данные клиента ниже",
  },
  editDialog: {
    title: "Редактирование клиента",
    description: "Измените данные выбранного клиента.",
  },
  form: {
    typeLabel: "Тип клиента *",
    fullNameLabel: "Полное имя *",
    organizationNameLabel: "Название организации *",
    fullNamePlaceholder: "Полное имя",
    organizationNamePlaceholder: "Название организации",
    taxIdLabel: "Налоговый код / IDNO",
    contactPersonLabel: "Контактное лицо",
    emailLabel: "Email *",
    phoneLabel: "Телефон *",
    addressLabel: "Адрес",
    addressPlaceholder: "Улица, город, район",
    notesLabel: "Заметки",
    notesPlaceholder: "Дополнительные заметки о клиенте...",
  },
  validation: {
    typeRequired: "Выберите тип клиента",
    fullNameRequired: "Укажите полное имя",
    organizationNameRequired: "Укажите название организации",
    emailRequired: "Укажите email",
    phoneRequired: "Укажите телефон",
    phoneFormat: "Телефон должен быть в формате +37300000000",
  },
  combobox: {
    placeholder: "Клиент",
    newClient: "Новый клиент: <strong>{{name}}</strong>",
  },
  detail: {
    editTitle: "Редактировать клиента",
    srDescription: "Просмотр и редактирование контактных данных, баланса и истории заказов этого клиента.",
    contactInformation: "Контактная информация",
    contact: "Контакт",
    taxId: "Налоговый код / IDNO",
    currentBalance: "Текущий баланс",
    orderHistory: "История заказов",
    noOrders: "Заказов пока нет",
    notes: "Заметки",
    clientSince: "Клиент с: {{date}}",
  },
  toast: {
    creating: "Создание клиента...",
    created: "Клиент успешно создан",
    createFailed: "Что-то пошло не так",
    updating: "Обновление клиента...",
    updated: "Клиент успешно обновлён",
  },
  errors: {
    loadFailed: "Не удалось загрузить клиентов",
    notAuthenticated: "Пользователь не авторизован",
    notFoundOrForbidden: "Клиент не найден или у вас нет прав на его редактирование.",
  },
};

export default clients;
