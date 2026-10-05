import type en from "../en/employees";
import type { Messages } from "../../types";

const employees: Messages<typeof en> = {
  title: "Сотрудники",
  loading: "Загрузка сотрудников",
  memberCount_one: "{{count}} сотрудник",
  memberCount_few: "{{count}} сотрудника",
  memberCount_many: "{{count}} сотрудников",
  memberCount_other: "{{count}} сотрудника",
  addEmployee: "Добавить сотрудника",
  searchPlaceholder: "Поиск сотрудников...",
  loadError: "Не удалось загрузить сотрудников",
  roles: {
    admin: "Администратор",
    manager: "Менеджер",
    technician: "Техник",
    receptionist: "Приёмщик",
  },
  statuses: {
    active: "Активен",
    inactive: "Неактивен",
  },
  filters: {
    role: "Роль",
    allRoles: "Все роли",
  },
  columns: {
    name: "Имя",
    role: "Роль",
    tasks: "Задачи",
    completed: "Выполнено",
  },
  tasksAssigned: "<value>{{value}}</value><muted> назначено</muted>",
  dialogs: {
    createTitle: "Новый сотрудник",
    createDescription: "Заполните данные сотрудника.",
  },
  form: {
    fullNameLabel: "ФИО *",
    namePlaceholder: "Имя сотрудника",
    nameRequired: "Укажите имя",
    emailLabel: "Email *",
    emailRequired: "Укажите email",
    emailInvalid: "Некорректный адрес email",
    phoneLabel: "Телефон *",
    phoneRequired: "Укажите телефон",
    phoneInvalid: "Телефон должен быть в формате +37300000000",
    roleLabel: "Роль *",
    roleRequired: "Укажите роль",
    rolePlaceholder: "Выберите роль",
    roleOptions: {
      admin: "Администратор",
      manager: "Менеджер",
      technician: "Техник",
      receptionist: "Приёмщик",
    },
    linkedUserLabel: "Связанный пользователь",
    notLinked: "Не связан",
    memberFallbackName: "Участник рабочего пространства",
    memberOption: "{{name}} ({{role}})",
    membersLoadError: "Не удалось загрузить участников рабочего пространства",
    linkedUserHint: "Свяжите учётную запись рабочего пространства, под которой входит этот сотрудник. Назначать на заказы можно только связанных сотрудников.",
    profileNotFound: "Профиль не найден",
  },
  detail: {
    contactInformation: "Контактная информация",
    assignedTasks: "Назначенные задачи",
    completedTasks: "Выполненные задачи",
    currentWorkload: "Текущая загрузка",
    activeTasks: "Активные задачи",
    heavyWorkload: "Высокая загрузка",
    moderateWorkload: "Средняя загрузка",
    lightWorkload: "Низкая загрузка",
  },
  toast: {
    creating: "Создание сотрудника",
    created: "Сотрудник успешно создан",
    genericError: "Что-то пошло не так",
  },
  errors: {
    noActiveWorkspace: "Нет активного рабочего пространства",
    notActiveMember: "Выбранный пользователь не является активным участником этого рабочего пространства",
  },
};

export default employees;
