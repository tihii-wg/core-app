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
    markAllRead: "Respinge toate",
    viewOrders: "Vezi comenzile",
    liveHint: "Alerte live din comenzile deschise curente — nu un inbox de notificări.",
    overdueOrder: "{{orderNumber}} este restantă",
    upcomingDeadline: "{{orderNumber}} are termen apropiat",
    unassignedOrder: "{{orderNumber}} nu are responsabil",
    deadlineDetail: "{{client}} · Termen {{deadline}}",
    unassignedDetail: "{{client}} · Neatribuită",
    unassignedWithDeadline: "{{client}} · Termen {{deadline}} · Neatribuită",
    unknownClient: "Client necunoscut",
    empty: "Ești la zi",
    emptyHint: "Comenzile deschise restante, cu termen apropiat sau neatribuite vor apărea aici.",
    loadError: "Alertele comenzilor nu au putut fi încărcate",
    loadErrorHint: "Reîmprospătează pagina pentru a încerca din nou.",
    unreadAria_one: "Notificări, {{count}} alertă",
    unreadAria_few: "Notificări, {{count}} alerte",
    unreadAria_other: "Notificări, {{count}} de alerte",
  },
  userMenu: {
    account: "Cont",
    profile: "Profil",
    logOut: "Deconectare",
  },
};

export default nav;
