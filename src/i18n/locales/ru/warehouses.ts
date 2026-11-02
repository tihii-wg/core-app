import type en from "../en/warehouses";
import type { Messages } from "../../types";

const warehouses: Messages<typeof en> = {
  title: "Склады",
  description: "Остатки по складам, приход, перемещения, списания и история движений.",
  loading: "Загрузка складов...",
  loadError: "Не удалось загрузить склады.",
  emptyTitle: "Складов пока нет",
  emptyDescription: "Создайте склад ниже, чтобы вести остатки по местам хранения, затем оформите приход. Склады не создаются автоматически.",
  selectorLabel: "Склад",
  allWarehouses: "Все склады",
  currentWarehouse: "Сейчас: {{name}}",
  manage: "Управление складами",
  openInventory: "Открыть каталог товаров",
  summary: {
    products: "Позиции с остатком",
    lowStock: "Мало на складе",
    outOfStock: "Нет в наличии",
    warehouses: "Активные склады",
  },
  actions: {
    receive: "Приход",
    transfer: "Перемещение",
    writeOff: "Списание",
    history: "История движений",
  },
  stock: {
    title: "Остатки на этом складе",
    titleAll: "Остатки по всем складам",
    empty: "По выбранному складу остатков пока нет.",
    product: "Товар",
    quantity: "Кол-во",
    min: "Мин.",
  },
  inventoryLink: {
    title: "Складские операции теперь здесь",
    description: "Приход, перемещения, списания и остатки по складам находятся на странице Склады.",
    open: "Открыть склады",
  },
};

export default warehouses;
