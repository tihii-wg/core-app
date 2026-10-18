import type en from "../en/finance";
import type { Messages } from "../../types";

const finance: Messages<typeof en> = {
  title: "Финансы",
  description: "Обзор выручки, расходов и прибыли",
  periodDescription: "Выручка по оплаченным счетам и учтённые расходы · {{range}}",
  rangeLabel: "Период",
  stats: {
    totalRevenue: "Общая выручка",
    totalExpenses: "Общие расходы",
    netProfit: "Чистая прибыль",
    outstanding: "Неоплаченные счета",
  },
  transactions: {
    title: "Операции",
    invoiceMethod: "Счёт",
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
  categories: {
    invoicePayment: "Оплата счёта",
  },
  invoiceDescription: "{{number}} · {{client}}",
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
  profitOverview: {
    title: "Обзор прибыли",
    revenue: "Выручка",
    expenses: "Расходы",
    netProfit: "Чистая прибыль",
    margin: "Рентабельность: <value>{{value}}%</value>",
  },
  expensesByCategory: "Расходы по категориям",
  expensesByPaymentMethod: "Расходы по способам оплаты",
  noExpensesInPeriod: "За этот период расходов нет.",
  empty: {
    title: "За этот период операций нет",
    description: "Здесь появляются оплаченные счета и учтённые расходы.",
  },
  expenses: {
    add: "Добавить расход",
    fields: {
      date: "Дата *",
      amount: "Сумма ({{currency}}) *",
      category: "Категория *",
      categoryPlaceholder: "например, Запчасти, Аренда, Коммунальные услуги",
      paymentMethod: "Способ оплаты",
      description: "Описание",
    },
    suggestedCategories: {
      parts: "Запчасти",
      rent: "Аренда",
      utilities: "Коммунальные услуги",
      salaries: "Зарплаты",
      tools: "Инструменты и оборудование",
      marketing: "Маркетинг",
      taxes: "Налоги и сборы",
      other: "Другое",
    },
    validation: {
      dateRequired: "Укажите дату",
      amountRequired: "Укажите сумму",
      amountPositive: "Сумма должна быть больше нуля",
      categoryRequired: "Укажите категорию",
      categoryTooLong: "Категория — не более 80 символов",
      descriptionTooLong: "Описание — не более 500 символов",
    },
    dialogs: {
      addTitle: "Добавить расход",
      editTitle: "Изменить расход",
      description: "Учёт расхода компании",
      deleteTitle: "Удалить расход?",
      deleteDescription: "{{category}} · {{amount}} будет удалён из раздела «Финансы».",
    },
    actions: {
      menuLabel: "Действия для расхода {{category}}",
    },
    toast: {
      creating: "Сохранение расхода...",
      created: "Расход добавлен",
      updating: "Сохранение расхода...",
      updated: "Расход обновлён",
      deleted: "Расход удалён",
    },
    errors: {
      unavailable: "Расходы ещё не настроены в этой базе данных. Примените миграцию расходов, чтобы их учитывать.",
      noPermission: "Управлять расходами может только владелец компании или администратор.",
      saveFailed: "Не удалось сохранить расход",
    },
  },
};

export default finance;
