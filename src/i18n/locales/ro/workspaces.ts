import type en from "../en/workspaces";
import type { Messages } from "../../types";

const workspaces: Messages<typeof en> = {
  create: {
    nameLabel: "Companie *",
    namePlaceholder: "Companie",
    nameRequired: "Numele este obligatoriu",
    businessTypeLabel: "Tipul afacerii *",
    businessTypePlaceholder: "Tipul afacerii",
    businessTypeRequired: "Tipul afacerii este obligatoriu",
    roleLabel: "Rol *",
    rolePlaceholder: "Rol",
    roleRequired: "Rolul este obligatoriu",
    submit: "Adaugă companie",
  },
  toast: {
    created: "Compania a fost creată!",
    createFailed: "Nu s-a putut crea compania",
    switching: "Se schimbă...",
    switched: "Compania a fost schimbată",
    switchFailed: "Nu s-a putut schimba compania",
  },
  redirect: {
    noWorkspaces: "Încă nu sunteți membru al niciunei companii.",
  },
  errors: {
    noAccess: "Nu aveți acces la această companie",
    industryNotFound: "Tipul de afacere selectat nu a fost găsit",
  },
  industries: {
    auto_repair: "Reparații și service auto",
    phone_electronics_repair: "Reparații telefoane și electronice",
    computer_repair: "Reparații calculatoare",
    appliance_repair: "Reparații electrocasnice",
    equipment_repair: "Reparații echipamente",
    electrical_services: "Servicii electrice",
    home_services: "Servicii la domiciliu",
    other: "Altele",
  },
  industryPresets: {
    restaurant: {
      label: "Restaurante și cafenele",
      hint: "Pentru localuri cu meniu, rezervări și clienți fideli.",
    },
    beauty: {
      label: "Saloane de înfrumusețare",
      hint: "Potrivit pentru programări, specialiști și programe de fidelitate.",
    },
    fitness: {
      label: "Fitness și sport",
      hint: "Pentru abonamente, antrenamente și fidelizarea clienților.",
    },
    medical: {
      label: "Medicină",
      hint: "Pentru clinici, consultații și lucrul atent cu pacienții.",
    },
    retail: {
      label: "Comerț cu amănuntul",
      hint: "Pentru magazine, comenzi și gestionarea sortimentului.",
    },
    professional_services: {
      label: "Servicii profesionale",
      hint: "Pentru agenții, consultanți și echipe de servicii.",
    },
    auto_service: {
      label: "Service auto",
      hint: "Pentru diagnosticare, reparații și programări la service.",
    },
    electronics_repair: {
      label: "Reparații electronice",
      hint: "Pentru ateliere, cereri de reparație și urmărirea stadiului reparațiilor.",
    },
  },
  logo: {
    errors: {
      invalidFile: "Selectați o imagine JPG, PNG sau WebP mai mică de 5 MB.",
      uploadFailed: "Nu s-a putut încărca sigla companiei. Vă rugăm să încercați din nou.",
      removeFailed: "Nu s-a putut elimina sigla companiei. Vă rugăm să încercați din nou.",
      loadFailed: "Nu s-a putut încărca sigla companiei. Vă rugăm să încercați din nou.",
      invalidWorkspaceId: "ID de companie invalid",
      noRowReturned: "Actualizarea siglei a eșuat: nu a fost returnat niciun rând",
      cropEmpty: "Zona de decupare este goală",
      canvasUnavailable: "Canvas-ul nu este disponibil",
      webpConversionFailed: "Conversia în WebP a eșuat",
      signedUrlEmpty: "Linkul semnat este gol",
      invalidLogoPath: "Calea siglei este invalidă",
      imageUnreadable: "Imaginea nu a putut fi citită",
    },
  },
};

export default workspaces;
