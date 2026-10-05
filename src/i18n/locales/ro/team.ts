import type en from "../en/team";
import type { Messages } from "../../types";

const team: Messages<typeof en> = {
  title: "Membri ai echipei",
  description: "Gestionați echipa și permisiunile membrilor",
  inviteMember: "Invitați un membru",
  memberFallbackName: "Membru al companiei",
  roles: {
    owner: "Proprietar",
    admin: "Administrator",
    manager: "Manager",
    member: "Membru",
  },
  members: {
    loading: "Se încarcă membrii echipei...",
    loadFailed: "Membrii echipei nu au putut fi încărcați",
    emptyTitle: "Încă nu există membri ai echipei",
    emptyDescription: "Membrii adăugați în această companie vor apărea aici.",
    active: "Activ",
    roleFor: "Rolul pentru {{name}}",
    remove: "Eliminați",
  },
  remove: {
    title: "Eliminați membrul echipei?",
    description: "{{name}} va pierde accesul la această companie.",
    removing: "Se elimină...",
    confirm: "Eliminați",
  },
  invite: {
    title: "Invitați un membru al echipei",
    description: "Oferiți unui cont Core App existent acces la această companie.",
    emailLabel: "E-mail",
    emailPlaceholder: "nume@companie.com",
    roleLabel: "Rol",
    invalidEmail: "Introduceți o adresă de e-mail validă",
    adding: "Se adaugă...",
    submit: "Adăugați membrul",
  },
  toast: {
    adding: "Se adaugă membrul echipei...",
    added: "Membrul echipei a fost adăugat",
    addFailed: "Membrul echipei nu a putut fi adăugat",
    updatingRole: "Se actualizează rolul...",
    roleUpdated: "Rolul a fost actualizat",
    roleUpdateFailed: "Rolul nu a putut fi actualizat",
    removing: "Se elimină membrul echipei...",
    removed: "Membrul echipei a fost eliminat",
    removeFailed: "Membrul echipei nu a putut fi eliminat",
  },
  errors: {
    migrationRequired: "Gestionarea membrilor echipei necesită cea mai recentă actualizare a bazei de date (supabase/migrations/20260929000300_team_member_rpcs.sql).",
    invalidRole: "Alegeți administrator, manager sau membru",
    emailRequired: "E-mailul este obligatoriu",
    noAddPermission: "Nu aveți permisiunea de a adăuga membri ai echipei",
    accountNotFound: "Niciun cont Core App nu folosește acest e-mail. Rugați persoana să se înregistreze mai întâi.",
    alreadyMemberSelf: "Sunteți deja membru al acestei companii",
    alreadyMember: "Acest utilizator este deja membru al echipei",
    noAddMemberPermission: "Nu aveți permisiunea de a adăuga acest membru al echipei",
    noRoleChangePermission: "Nu aveți permisiunea de a schimba rolul acestui membru",
    noRemovePermission: "Nu aveți permisiunea de a elimina acest membru",
  },
};

export default team;
