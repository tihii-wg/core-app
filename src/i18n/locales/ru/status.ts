import type en from "../en/status";
import type { Messages } from "../../types";

const status: Messages<typeof en> = {
  order: {
    new: "Новый",
    "in-progress": "В работе",
    "waiting-parts": "Ожидает запчасти",
    completed: "Выполнен",
    paid: "Оплачен",
    cancelled: "Отменён",
    byIndustry: {
      auto_repair: {
        "waiting-parts": "Ожидает запчасти",
      },
      repair_device: {
        "waiting-parts": "Ожидает запчасти",
      },
      field_service: {
        "waiting-parts": "Ожидает расходники",
      },
      default: {
        "waiting-parts": "Ожидает запчасти",
      },
    },
  },
  payment: {
    unpaid: "Не оплачен",
    partial: "Частично",
    paid: "Оплачен",
  },
  invoice: {
    draft: "Черновик",
    sent: "Отправлен",
    paid: "Оплачен",
    overdue: "Просрочен",
  },
  inventory: {
    in_stock: "В наличии",
    low_stock: "Мало на складе",
    out_of_stock: "Нет в наличии",
  },
};

export default status;
