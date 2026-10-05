import type en from "../en/search";
import type { Messages } from "../../types";

const search: Messages<typeof en> = {
  inputLabel: "Caută comenzi, clienți și articole din stoc",
  resultsLabel: "Rezultatele căutării",
  minLength_one: "Introduceți cel puțin {{count}} caracter pentru a căuta.",
  minLength_few: "Introduceți cel puțin {{count}} caractere pentru a căuta.",
  minLength_other: "Introduceți cel puțin {{count}} de caractere pentru a căuta.",
  searching: "Se caută...",
  noResults: "Niciun rezultat pentru „{{term}}”",
  groupCount: "{{shown}} din {{total}}",
  groups: {
    orders: "Comenzi",
    clients: "Clienți",
    inventory: "Stoc",
  },
  errors: {
    orders: "Comenzile nu au putut fi încărcate.",
    clients: "Clienții nu au putut fi încărcați.",
    inventory: "Stocul nu a putut fi încărcat.",
  },
};

export default search;
