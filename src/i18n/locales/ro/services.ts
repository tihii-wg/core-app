import type en from "../en/services";
import type { Messages } from "../../types";

const services: Messages<typeof en> = {
  title: "Servicii",
  loading: "Se încarcă serviciile...",
  activeCount_one: "{{count}} serviciu activ",
  activeCount_few: "{{count}} servicii active",
  activeCount_other: "{{count}} de servicii active",
  addService: "Adaugă serviciu",
  searchPlaceholder: "Caută servicii...",
  loadError: "Serviciile nu au putut fi încărcate",
  deleteAriaLabel: "Șterge {{name}}",
  columns: {
    service: "Serviciu",
    price: "Preț",
  },
  statuses: {
    active: "Activ",
    inactive: "Inactiv",
  },
  dialogs: {
    createTitle: "Adaugă serviciu nou",
    createDescription: "Gestionează serviciile spațiului de lucru",
    editTitle: "Editează serviciul",
    editDescription: "Editează serviciul spațiului de lucru",
    deleteTitle: "Ștergi serviciul?",
    deleteDescription: "Confirmă ștergerea serviciului selectat.",
    deleteConfirm: "Sigur vrei să ștergi <strong>{{name}}</strong>?",
  },
  form: {
    serviceNameRequiredLabel: "Denumirea serviciului *",
    serviceNameLabel: "Denumirea serviciului",
    serviceRequired: "Serviciul este obligatoriu",
    serviceNameRequired: "Denumirea serviciului este obligatorie",
    priceLabel: "Preț ({{currency}}) *",
    priceRequired: "Prețul este obligatoriu",
    priceNegative: "Prețul nu poate fi negativ",
    descriptionLabel: "Descriere",
    descriptionPlaceholder: "Scurtă descriere a acestui serviciu...",
  },
  combobox: {
    placeholder: "Serviciu",
    priceAriaLabel: "Preț",
    create: "Creează: <strong>{{name}}</strong>",
  },
  toast: {
    creating: "Se creează serviciul",
    created: "Serviciul a fost creat cu succes",
    duplicateName: "Există deja un serviciu cu această denumire",
    genericError: "Ceva nu a funcționat",
    updating: "Se actualizează serviciul",
    updated: "Serviciul a fost actualizat",
    deleting: "Se șterge serviciul",
    deleted: "Serviciul a fost șters",
    deleteFailed: "Serviciul nu a putut fi șters",
  },
  errors: {
    duplicateName: "Există deja un serviciu cu această denumire",
    createPermission: "Nu ai permisiunea de a crea servicii în acest spațiu de lucru.",
    notFound: "Serviciul nu a fost găsit.",
    editPermission: "Nu ai permisiunea de a edita acest serviciu.",
    usedInOrders: "Acest serviciu este folosit în comenzi și nu poate fi șters. Setează-l ca inactiv.",
    deletePermission: "Nu ai permisiunea de a șterge acest serviciu.",
  },
};

export default services;
