import type en from "../en/finance";
import type { Messages } from "../../types";

const finance: Messages<typeof en> = {
  title: "Финансы",
  description: "Обзор выручки, расходов и прибыли",
  demoDescription: "Предпросмотр страницы с примерами операций",
  demoNotice: {
    title: "Финансы пока не подключены к вашему рабочему пространству",
    body: "Все цифры на этой странице — примеры для предпросмотра. Они не рассчитаны на основе ваших заказов, клиентов или склада.",
  },
  stats: {
    totalRevenue: "Общая выручка",
    totalExpenses: "Общие расходы",
    netProfit: "Чистая прибыль",
    transactions: "Операции",
  },
  transactions: {
    title: "Последние операции",
    columns: {
      date: "Дата",
      type: "Тип",
      category: "Категория",
      description: "Описание",
      method: "Способ",
      amount: "Сумма",
    },
    types: {
      income: "Доход",
      expense: "Расход",
    },
  },
  paymentMethods: {
    short: {
      cash: "Наличные",
      card: "Карта",
      "bank-transfer": "Банк",
      other: "Другое",
    },
    full: {
      cash: "Наличные",
      card: "Карта",
      "bank-transfer": "Банковский перевод",
      other: "Другое",
    },
  },
  revenueByPaymentMethod: "Выручка по способам оплаты",
  profitOverview: {
    title: "Обзор прибыли",
    revenue: "Выручка",
    expenses: "Расходы",
    netProfit: "Чистая прибыль",
    margin: "Рентабельность: <value>{{value}}%</value>",
  },
  topExpenses: "Основные расходы",
  demo: {
    categories: {
      serviceRevenue: "Выручка от услуг",
      inventoryPurchase: "Закупка запасов",
      utilities: "Коммунальные услуги",
      rent: "Аренда",
      partsSale: "Продажа запчастей",
      marketing: "Маркетинг",
    },
    descriptions: {
      ipadScreen: "Оплата замены экрана iPad Pro",
      dellSoftware: "Оплата установки ПО на Dell XPS",
      iphoneScreens: "Экраны iPhone 14 Pro x5 от TechParts Direct",
      watchScreen: "Оплата замены экрана Apple Watch",
      electricity: "Ежемесячный счёт за электроэнергию",
      rent: "Ежемесячная аренда офиса",
      macbookDiagnostics: "Оплата диагностики MacBook",
      macbookBatteries: "Аккумуляторы MacBook Pro x3 от Apple Parts Co",
      chargerSale: "Продажа зарядного устройства USB-C случайному покупателю",
      googleAds: "Ежемесячный бюджет Google Ads",
    },
  },
};

export default finance;
