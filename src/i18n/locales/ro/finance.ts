import type en from "../en/finance";
import type { Messages } from "../../types";

const finance: Messages<typeof en> = {
  title: "Finanțe",
  description: "Prezentare generală a veniturilor, cheltuielilor și profitului",
  demoDescription: "Previzualizare a aspectului cu tranzacții exemplu",
  demoNotice: {
    title: "Finanțele nu sunt încă conectate la spațiul tău de lucru",
    body: "Toate cifrele de pe această pagină sunt valori exemplu pentru previzualizarea aspectului. Nu sunt calculate din comenzile, clienții sau stocul tău.",
  },
  stats: {
    totalRevenue: "Venituri totale",
    totalExpenses: "Cheltuieli totale",
    netProfit: "Profit net",
    transactions: "Tranzacții",
  },
  transactions: {
    title: "Tranzacții recente",
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
  revenueByPaymentMethod: "Venituri după metoda de plată",
  profitOverview: {
    title: "Prezentare profit",
    revenue: "Venituri",
    expenses: "Cheltuieli",
    netProfit: "Profit net",
    margin: "Marjă de profit: <value>{{value}}%</value>",
  },
  topExpenses: "Cheltuieli principale",
  demo: {
    categories: {
      serviceRevenue: "Venituri din servicii",
      inventoryPurchase: "Achiziție de stoc",
      utilities: "Utilități",
      rent: "Chirie",
      partsSale: "Vânzare de piese",
      marketing: "Marketing",
    },
    descriptions: {
      ipadScreen: "Plată pentru înlocuirea ecranului iPad Pro",
      dellSoftware: "Plată pentru instalarea software pe Dell XPS",
      iphoneScreens: "Ecrane iPhone 14 Pro x5 de la TechParts Direct",
      watchScreen: "Plată pentru înlocuirea ecranului Apple Watch",
      electricity: "Factura lunară la energie electrică",
      rent: "Chiria lunară a biroului",
      macbookDiagnostics: "Plată pentru diagnosticarea MacBook",
      macbookBatteries: "Baterii MacBook Pro x3 de la Apple Parts Co",
      chargerSale: "Vânzare încărcător USB-C către un client ocazional",
      googleAds: "Buget lunar Google Ads",
    },
  },
};

export default finance;
