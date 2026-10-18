import type en from "../en/onboarding";
import type { Messages } from "../../types";

const onboarding: Messages<typeof en> = {
  title: "Spuneți-ne despre afacerea dvs.",
  description: "Alegeți tipul de afacere pe care o desfășurați. Folosim această informație pentru a configura spațiul de lucru.",
  loading: "Se încarcă tipurile de afaceri...",
  empty: "Nu există tipuri de afaceri disponibile momentan.",
  loadFailed: "Tipurile de afaceri nu au putut fi încărcate.",
  errors: {
    saveFailed: "Tipul afacerii nu a putut fi salvat. Încercați din nou.",
  },
};

export default onboarding;
