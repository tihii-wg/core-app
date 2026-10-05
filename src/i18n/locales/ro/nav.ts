import type en from "../en/nav";
import type { Messages } from "../../types";

const nav: Messages<typeof en> = {
  modules: {
    dashboard: "Panou de control",
    orders: "Comenzi",
    clients: "Clienți",
    services: "Servicii",
    inventory: "Stoc",
    employees: "Angajați",
    invoices: "Facturi",
    finance: "Finanțe",
    reports: "Rapoarte",
    settings: "Setări",
  },
  groups: {
    operations: "Operațiuni",
    people: "Personal",
    finance: "Finanțe",
  },
  sidebar: {
    mainLabel: "Principal",
    demo: "Demo",
    openNavigation: "Deschide navigarea",
    closeNavigation: "Închide navigarea",
    expandSidebar: "Extinde bara laterală",
    collapseSidebar: "Restrânge bara laterală",
    collapse: "Restrânge",
  },
  workspace: {
    fallbackName: "Companie",
    logoAlt: "Logo {{name}}",
    addTitle: "Adaugă o companie nouă",
    addDescription: "Introduceți mai jos numele companiei",
    switchCompany: "Schimbă compania",
    addCompany: "+ Adaugă companie",
    deleteCompany: "Șterge {{name}}",
  },
  notifications: {
    title: "Notificări",
    markAllRead: "Marchează toate ca citite",
    viewAll: "Vezi toate notificările",
    newOrder: "Comandă nouă primită",
    invoiceOverdue: "Factura #{{invoiceNumber}} este restantă",
    lowStock: "Alertă stoc redus: {{itemName}}",
    minutesAgo_one: "acum {{count}} min",
    minutesAgo_few: "acum {{count}} min",
    minutesAgo_other: "acum {{count}} min",
    hoursAgo_one: "acum {{count}} oră",
    hoursAgo_few: "acum {{count}} ore",
    hoursAgo_other: "acum {{count}} de ore",
  },
  userMenu: {
    account: "Cont",
    profile: "Profil",
    logOut: "Deconectare",
  },
};

export default nav;
