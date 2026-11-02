import type en from "../en/warehouses";
import type { Messages } from "../../types";

const warehouses: Messages<typeof en> = {
  title: "Depozite",
  description: "Stoc pe depozite, recepții, transferuri, casări și istoricul mișcărilor.",
  loading: "Se încarcă depozitele...",
  loadError: "Depozitele nu au putut fi încărcate.",
  emptyTitle: "Nu există depozite încă",
  emptyDescription: "Creați un depozit mai jos pentru a urmări stocul pe locații, apoi recepționați bunuri. Depozitele nu se creează automat.",
  selectorLabel: "Depozit",
  allWarehouses: "Toate depozitele",
  currentWarehouse: "Curent: {{name}}",
  manage: "Gestionează depozitele",
  openInventory: "Deschide catalogul de stoc",
  summary: {
    products: "Produse cu stoc",
    lowStock: "Stoc redus",
    outOfStock: "Fără stoc",
    warehouses: "Depozite active",
  },
  actions: {
    receive: "Recepție",
    transfer: "Transfer",
    writeOff: "Casare",
    history: "Istoric mișcări",
  },
  stock: {
    title: "Stoc în acest depozit",
    titleAll: "Stoc pe toate depozitele",
    empty: "Nu există încă rânduri de stoc pentru această selecție.",
    product: "Produs",
    quantity: "Cant.",
    min: "Min.",
  },
  inventoryLink: {
    title: "Operațiunile de depozit sunt aici",
    description: "Recepțiile, transferurile, casările și stocul pe depozite sunt pe pagina Depozite.",
    open: "Deschide Depozite",
  },
};

export default warehouses;
