import type en from "../en/employees";
import type { Messages } from "../../types";

const employees: Messages<typeof en> = {
  title: "Angajați",
  loading: "Se încarcă angajații",
  memberCount_one: "{{count}} membru al echipei",
  memberCount_few: "{{count}} membri ai echipei",
  memberCount_other: "{{count}} de membri ai echipei",
  addEmployee: "Adaugă angajat",
  searchPlaceholder: "Caută angajați...",
  loadError: "Angajații nu au putut fi încărcați",
  roles: {
    admin: "Administrator",
    manager: "Manager",
    technician: "Tehnician",
    receptionist: "Recepționer",
  },
  statuses: {
    active: "Activ",
    inactive: "Inactiv",
  },
  filters: {
    role: "Rol",
    allRoles: "Toate rolurile",
  },
  columns: {
    name: "Nume",
    role: "Rol",
    tasks: "Sarcini",
    completed: "Finalizate",
  },
  tasksAssigned: "<value>{{value}}</value><muted> atribuite</muted>",
  dialogs: {
    createTitle: "Adaugă angajat nou",
    createDescription: "Completează mai jos informațiile despre angajat.",
  },
  form: {
    fullNameLabel: "Nume complet *",
    namePlaceholder: "Numele angajatului",
    nameRequired: "Numele este obligatoriu",
    emailLabel: "Email *",
    emailRequired: "Emailul este obligatoriu",
    emailInvalid: "Adresă de email invalidă",
    phoneLabel: "Telefon *",
    phoneRequired: "Telefonul este obligatoriu",
    phoneInvalid: "Telefonul trebuie să fie în formatul +37300000000",
    roleLabel: "Rol *",
    roleRequired: "Rolul este obligatoriu",
    rolePlaceholder: "Selectează rolul",
    roleOptions: {
      admin: "Administrator",
      manager: "Manager",
      technician: "Tehnician",
      receptionist: "Recepționer",
    },
    linkedUserLabel: "Utilizator asociat",
    notLinked: "Neasociat",
    memberFallbackName: "Membru al spațiului de lucru",
    memberOption: "{{name}} ({{role}})",
    membersLoadError: "Membrii spațiului de lucru nu au putut fi încărcați",
    linkedUserHint: "Asociază contul din spațiul de lucru cu care se autentifică acest angajat. Doar angajații asociați pot fi atribuiți comenzilor.",
    profileNotFound: "Profilul nu a fost găsit",
  },
  detail: {
    contactInformation: "Date de contact",
    assignedTasks: "Sarcini atribuite",
    completedTasks: "Sarcini finalizate",
    currentWorkload: "Volum de lucru curent",
    activeTasks: "Sarcini active",
    heavyWorkload: "Volum de lucru ridicat",
    moderateWorkload: "Volum de lucru moderat",
    lightWorkload: "Volum de lucru redus",
  },
  toast: {
    creating: "Se creează angajatul",
    created: "Angajatul a fost creat cu succes",
    genericError: "Ceva nu a funcționat",
  },
  errors: {
    noActiveWorkspace: "Niciun spațiu de lucru activ",
    notActiveMember: "Utilizatorul selectat nu este un membru activ al acestui spațiu de lucru",
  },
};

export default employees;
