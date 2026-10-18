import type en from "../en/finance";
import type { Messages } from "../../types";

const finance: Messages<typeof en> = {
  title: "Finanțe",
  description: "Prezentare generală a veniturilor, cheltuielilor și profitului",
  periodDescription: "Venituri din facturi achitate și cheltuieli înregistrate · {{range}}",
  rangeLabel: "Perioadă",
  stats: {
    totalRevenue: "Venituri totale",
    totalExpenses: "Cheltuieli totale",
    netProfit: "Profit net",
    outstanding: "Facturi neachitate",
  },
  transactions: {
    title: "Tranzacții",
    invoiceMethod: "Factură",
    columns: {
      date: "Dată",
      type: "Tip",
      category: "Categorie",
      description: "Descriere",
      method: "Metodă",
      amount: "Sumă",
    },
    types: {
      income: "Venit",
      expense: "Cheltuială",
    },
  },
  categories: {
    invoicePayment: "Plată factură",
  },
  invoiceDescription: "{{number}} · {{client}}",
  paymentMethods: {
    short: {
      cash: "Numerar",
      card: "Card",
      "bank-transfer": "Bancă",
      other: "Altele",
    },
    full: {
      cash: "Numerar",
      card: "Card",
      "bank-transfer": "Transfer bancar",
      other: "Altele",
    },
  },
  profitOverview: {
    title: "Prezentare profit",
    revenue: "Venituri",
    expenses: "Cheltuieli",
    netProfit: "Profit net",
    margin: "Marjă de profit: <value>{{value}}%</value>",
  },
  expensesByCategory: "Cheltuieli pe categorii",
  expensesByPaymentMethod: "Cheltuieli după metoda de plată",
  noExpensesInPeriod: "Nu există cheltuieli în această perioadă.",
  empty: {
    title: "Nu există tranzacții în această perioadă",
    description: "Aici apar facturile achitate și cheltuielile înregistrate.",
  },
  expenses: {
    add: "Adăugați cheltuială",
    fields: {
      date: "Dată *",
      amount: "Sumă ({{currency}}) *",
      category: "Categorie *",
      categoryPlaceholder: "de ex. Piese, Chirie, Utilități",
      paymentMethod: "Metodă de plată",
      description: "Descriere",
    },
    suggestedCategories: {
      parts: "Piese",
      rent: "Chirie",
      utilities: "Utilități",
      salaries: "Salarii",
      tools: "Unelte și echipamente",
      marketing: "Marketing",
      taxes: "Taxe și comisioane",
      other: "Altele",
    },
    validation: {
      dateRequired: "Data este obligatorie",
      amountRequired: "Suma este obligatorie",
      amountPositive: "Suma trebuie să fie mai mare decât zero",
      categoryRequired: "Categoria este obligatorie",
      categoryTooLong: "Categoria poate avea cel mult 80 de caractere",
      descriptionTooLong: "Descrierea poate avea cel mult 500 de caractere",
    },
    dialogs: {
      addTitle: "Adăugați cheltuială",
      editTitle: "Editați cheltuiala",
      description: "Înregistrați o cheltuială a companiei",
      deleteTitle: "Ștergeți cheltuiala?",
      deleteDescription: "{{category}} · {{amount}} va fi eliminată din Finanțe.",
    },
    actions: {
      menuLabel: "Acțiuni pentru cheltuiala {{category}}",
    },
    toast: {
      creating: "Se salvează cheltuiala...",
      created: "Cheltuiala a fost adăugată",
      updating: "Se salvează cheltuiala...",
      updated: "Cheltuiala a fost actualizată",
      deleted: "Cheltuiala a fost ștearsă",
    },
    errors: {
      unavailable: "Cheltuielile nu sunt încă configurate în această bază de date. Aplicați migrarea pentru cheltuieli pentru a le înregistra.",
      noPermission: "Doar proprietarul companiei sau un administrator poate gestiona cheltuielile.",
      saveFailed: "Cheltuiala nu a putut fi salvată",
    },
  },
};

export default finance;
