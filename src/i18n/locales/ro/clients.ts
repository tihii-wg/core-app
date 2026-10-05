import type en from "../en/clients";
import type { Messages } from "../../types";

const clients: Messages<typeof en> = {
  title: "Clienți",
  loading: "Se încarcă clienții...",
  totalCount_one: "{{count}} client în total",
  totalCount_few: "{{count}} clienți în total",
  totalCount_other: "{{count}} de clienți în total",
  addClient: "Adaugă client",
  searchPlaceholder: "Caută după nume, cod fiscal, persoană de contact, email, telefon sau adresă...",
  editClientLabel: "Editează {{name}}",
  types: {
    individual: "Persoană fizică",
    organization: "Persoană juridică",
  },
  filters: {
    clientType: "Tip client",
    individuals: "Persoane fizice",
    organizations: "Persoane juridice",
  },
  table: {
    name: "Nume",
    clientType: "Tip client",
    contact: "Contact",
    orders: "Comenzi",
    balance: "Sold",
    added: "Adăugat",
  },
  addDialog: {
    title: "Client nou",
    description: "Completați datele clientului mai jos",
  },
  editDialog: {
    title: "Editează clientul",
    description: "Actualizați datele clientului selectat.",
  },
  form: {
    typeLabel: "Tip client *",
    fullNameLabel: "Nume complet *",
    organizationNameLabel: "Denumirea organizației *",
    fullNamePlaceholder: "Nume complet",
    organizationNamePlaceholder: "Denumirea organizației",
    taxIdLabel: "Cod fiscal / IDNO",
    contactPersonLabel: "Persoană de contact",
    emailLabel: "Email *",
    phoneLabel: "Telefon *",
    addressLabel: "Adresă",
    addressPlaceholder: "Stradă, oraș, raion",
    notesLabel: "Note",
    notesPlaceholder: "Note suplimentare despre acest client...",
  },
  validation: {
    typeRequired: "Tipul clientului este obligatoriu",
    fullNameRequired: "Numele complet este obligatoriu",
    organizationNameRequired: "Denumirea organizației este obligatorie",
    emailRequired: "Emailul este obligatoriu",
    phoneRequired: "Telefonul este obligatoriu",
    phoneFormat: "Telefonul trebuie să fie în formatul +37300000000",
  },
  combobox: {
    placeholder: "Client",
    newClient: "Client nou: <strong>{{name}}</strong>",
  },
  detail: {
    editTitle: "Editează clientul",
    srDescription: "Vizualizați și editați datele de contact, soldul și istoricul comenzilor acestui client.",
    contactInformation: "Date de contact",
    contact: "Contact",
    taxId: "Cod fiscal / IDNO",
    currentBalance: "Sold curent",
    orderHistory: "Istoricul comenzilor",
    noOrders: "Nicio comandă încă",
    notes: "Note",
    clientSince: "Client din: {{date}}",
  },
  toast: {
    creating: "Se creează clientul...",
    created: "Clientul a fost creat cu succes",
    createFailed: "Ceva nu a funcționat",
    updating: "Se actualizează clientul...",
    updated: "Clientul a fost actualizat cu succes",
  },
  errors: {
    loadFailed: "Clienții nu au putut fi încărcați",
    notAuthenticated: "Utilizatorul nu este autentificat",
    notFoundOrForbidden: "Clientul nu a fost găsit sau nu aveți permisiunea de a-l edita.",
  },
};

export default clients;
