import type en from "../en/nav";
import type { Messages } from "../../types";

const nav: Messages<typeof en> = {
  modules: {
    dashboard: "Панель управления",
    orders: "Заказы",
    clients: "Клиенты",
    services: "Услуги",
    inventory: "Склад",
    employees: "Сотрудники",
    invoices: "Счета",
    finance: "Финансы",
    reports: "Отчёты",
    settings: "Настройки",
  },
  groups: {
    operations: "Операции",
    people: "Персонал",
    finance: "Финансы",
  },
  sidebar: {
    mainLabel: "Основная навигация",
    demo: "Демо",
    openNavigation: "Открыть навигацию",
    closeNavigation: "Закрыть навигацию",
    expandSidebar: "Развернуть боковую панель",
    collapseSidebar: "Свернуть боковую панель",
    collapse: "Свернуть",
  },
  workspace: {
    fallbackName: "Компания",
    logoAlt: "Логотип {{name}}",
    addTitle: "Новая компания",
    addDescription: "Введите название компании ниже",
    switchCompany: "Сменить компанию",
    addCompany: "+ Добавить компанию",
    deleteCompany: "Удалить {{name}}",
  },
  notifications: {
    title: "Уведомления",
    markAllRead: "Отметить все как прочитанные",
    viewAll: "Все уведомления",
    newOrder: "Получен новый заказ",
    invoiceOverdue: "Счёт #{{invoiceNumber}} просрочен",
    lowStock: "Заканчивается на складе: {{itemName}}",
    minutesAgo_one: "{{count}} мин назад",
    minutesAgo_few: "{{count}} мин назад",
    minutesAgo_many: "{{count}} мин назад",
    minutesAgo_other: "{{count}} мин назад",
    hoursAgo_one: "{{count}} час назад",
    hoursAgo_few: "{{count}} часа назад",
    hoursAgo_many: "{{count}} часов назад",
    hoursAgo_other: "{{count}} часа назад",
  },
  userMenu: {
    account: "Аккаунт",
    profile: "Профиль",
    logOut: "Выйти",
  },
};

export default nav;
