import type en from "../en/search";
import type { Messages } from "../../types";

const search: Messages<typeof en> = {
  inputLabel: "Поиск по заказам, клиентам и складу",
  resultsLabel: "Результаты поиска",
  minLength_one: "Введите не менее {{count}} символа для поиска.",
  minLength_few: "Введите не менее {{count}} символов для поиска.",
  minLength_many: "Введите не менее {{count}} символов для поиска.",
  minLength_other: "Введите не менее {{count}} символа для поиска.",
  searching: "Поиск...",
  noResults: "По запросу «{{term}}» ничего не найдено",
  groupCount: "{{shown}} из {{total}}",
  groups: {
    orders: "Заказы",
    clients: "Клиенты",
    inventory: "Склад",
  },
  errors: {
    orders: "Не удалось загрузить заказы.",
    clients: "Не удалось загрузить клиентов.",
    inventory: "Не удалось загрузить склад.",
  },
};

export default search;
