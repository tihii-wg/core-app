import type en from "../en/statusNames";
import type { Messages } from "../../types";

const statusNames: Messages<typeof en> = {
  order: {
    approval: "На согласовании",
    waitingPart: "Ждет запчасть",
    waitingPayment: "Ждём ОПЛАТЫ",
  },
  estimate: {
    draft: "Черновик",
    pending: "В ожидании",
    sent: "Отправлен",
    orderCreated: "Заказ создан",
    rejected: "Отклонен",
  },
  lead: {
    newInquiry: "Новое обращение",
    convertedToOrder: "Успешный заказ",
    successfulSale: "Успешная продажа",
    tooExpensive: "Дорого",
    changedMind: "Передумал",
    mistakenInquiry: "Ошибочное обращение",
  },
  invoice: {
    issued: "Выставлен",
    paid: "Оплачено",
  },
  transfer: {
    readyToShip: "Готово к отправке",
    inTransit: "В пути",
    received: "Получено",
    canceled: "Отменено",
  },
  task: {
    toDo: "К выполнению",
    postponed: "Отложенные",
    done: "Готово",
  },
};

export default statusNames;
