import { useParams } from "react-router-dom";

/** Contact for privacy questions (shown publicly on /privacy). */
export const PRIVACY_CONTACT_EMAIL = "vladimirpodolian@gmail.com";
const UPDATED = "2026-11-13";

type Section = { title: string; body: string[] };
type Policy = { title: string; updated: string; intro: string; sections: Section[] };

const POLICIES: Record<"ru" | "ro" | "en", Policy> = {
  ru: {
    title: "Политика конфиденциальности Core App",
    updated: "Обновлено",
    intro:
      "Core App — CRM для сервисных компаний (заказы, клиенты, склад, оплаты). Эта политика объясняет, какие данные мы обрабатываем и как используем доступ к Google Диску и Google Календарю.",
    sections: [
      {
        title: "Какие данные мы обрабатываем",
        body: [
          "Данные аккаунта: имя, адрес электронной почты, данные входа.",
          "Данные, которые компания вносит в приложение: клиенты, заказы, услуги, склад, оплаты, документы и фото заказов.",
          "Технические данные, необходимые для работы и безопасности сервиса (журналы ошибок, время входа).",
        ],
      },
      {
        title: "Google Диск",
        body: [
          "Владелец компании может подключить свой Google Диск для хранения фото и файлов заказов. Мы запрашиваем только доступ drive.file — к файлам и папкам, которые создаёт само приложение, и адрес почты аккаунта. Другие файлы на вашем Диске приложению недоступны.",
          "Доступ используется только для того, чтобы сохранять фото заказов в папку «Core App» на вашем Диске, показывать их в соответствующем заказе и удалять их, когда вы удаляете фото или заказ.",
          "Ключ доступа хранится в зашифрованном виде на сервере и никогда не передаётся в браузер. Данные из Google не продаются, не передаются третьим лицам, не используются для рекламы и для обучения моделей ИИ.",
          "Использование и передача Core App информации, полученной из API Google, соответствует Политике в отношении пользовательских данных сервисов Google API (Google API Services User Data Policy), включая требования об ограниченном использовании (Limited Use).",
          "Отключить Google Диск можно в любой момент в Настройки → Хранилище, а также отозвать доступ на странице https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "Google Календарь",
        body: [
          "Владелец компании может подключить свой Google Календарь, чтобы команда вела общий календарь внутри Core App. Мы запрашиваем доступ calendar.events (чтение и запись событий), calendar.calendarlist.readonly (список календарей владельца для выбора) и адрес почты аккаунта.",
          "Читается и изменяется только календарь, который владелец явно выбрал (например отдельный календарь «Мастерская»). Другие календари Google и личные события в них приложению недоступны для записи.",
          "Ключ доступа хранится в зашифрованном виде на сервере (Supabase Vault) и никогда не передаётся в браузер. Все обращения к Google Calendar API выполняются с сервера. Данные календаря не продаются, не передаются третьим лицам, не используются для рекламы и для обучения моделей ИИ.",
          "Отключить Google Календарь можно в любой момент в Календарь / Настройки → Хранилище; при отключении доступ у Google отзывается (best effort). Также можно отозвать доступ на https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "Как мы используем данные",
        body: [
          "Только для работы приложения: показ и обработка данных вашей компании, печать документов, уведомления, поддержка пользователей.",
          "Данные компании видны только её участникам в соответствии с их ролями.",
        ],
      },
      {
        title: "Хранение и удаление",
        body: [
          "Данные хранятся у провайдеров инфраструктуры (Supabase, Vercel) и, если выбрано владельцем, на его Google Диске, Google Календаре или NAS.",
          "Вы можете запросить выгрузку или удаление данных, написав нам. Файлы и события на вашем Google Диске / Календаре или NAS остаются под вашим контролем.",
        ],
      },
      {
        title: "Контакты",
        body: [`По вопросам конфиденциальности: ${PRIVACY_CONTACT_EMAIL}`],
      },
    ],
  },
  ro: {
    title: "Politica de confidențialitate Core App",
    updated: "Actualizat",
    intro:
      "Core App este un CRM pentru companii de servicii (comenzi, clienți, stoc, plăți). Această politică explică ce date prelucrăm și cum folosim accesul la Google Drive și Google Calendar.",
    sections: [
      {
        title: "Ce date prelucrăm",
        body: [
          "Datele contului: nume, e-mail, date de autentificare.",
          "Datele introduse de companie: clienți, comenzi, servicii, stoc, plăți, documente și fotografii ale comenzilor.",
          "Date tehnice necesare funcționării și securității serviciului.",
        ],
      },
      {
        title: "Google Drive",
        body: [
          "Proprietarul companiei poate conecta propriul Google Drive pentru stocarea fotografiilor și fișierelor comenzilor. Solicităm doar accesul drive.file — la fișierele și folderele create de aplicație — și adresa de e-mail a contului. Celelalte fișiere din Drive nu sunt accesibile aplicației.",
          "Accesul este folosit doar pentru a salva fotografiile comenzilor în folderul „Core App”, a le afișa în comanda respectivă și a le șterge când ștergeți fotografia sau comanda.",
          "Cheia de acces este stocată criptat pe server și nu ajunge în browser. Datele Google nu sunt vândute, transmise terților, folosite pentru publicitate sau pentru antrenarea modelelor AI.",
          "Utilizarea și transferul de către Core App al informațiilor primite de la API-urile Google respectă Google API Services User Data Policy, inclusiv cerințele Limited Use.",
          "Puteți deconecta Google Drive oricând din Setări → Stocare sau revoca accesul la https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "Google Calendar",
        body: [
          "Proprietarul companiei poate conecta Google Calendar pentru un calendar partajat în Core App. Solicităm accesul calendar.events (citire/scriere evenimente), calendar.calendarlist.readonly (lista calendarelor pentru selecție) și adresa de e-mail.",
          "Este citit și modificat doar calendarul ales explicit de proprietar. Celelalte calendare Google rămân inaccesibile pentru scriere.",
          "Cheia de acces este stocată criptat pe server (Supabase Vault) și nu ajunge în browser. Toate apelurile către Google Calendar API rulează pe server.",
          "Puteți deconecta Google Calendar oricând din Calendar / Setări → Stocare; la deconectare accesul este revocat la Google (best effort). De asemenea pe https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "Cum folosim datele",
        body: ["Doar pentru funcționarea aplicației și asistență. Datele companiei sunt vizibile doar membrilor ei, conform rolurilor."],
      },
      {
        title: "Stocare și ștergere",
        body: [
          "Datele sunt găzduite la furnizori de infrastructură (Supabase, Vercel) și, la alegerea proprietarului, în Google Drive, Google Calendar sau NAS-ul acestuia.",
          "Puteți solicita exportul sau ștergerea datelor scriindu-ne.",
        ],
      },
      { title: "Contact", body: [`Întrebări despre confidențialitate: ${PRIVACY_CONTACT_EMAIL}`] },
    ],
  },
  en: {
    title: "Core App Privacy Policy",
    updated: "Updated",
    intro:
      "Core App is a CRM for service businesses (orders, clients, inventory, payments). This policy explains what data we process and how we use Google Drive and Google Calendar access.",
    sections: [
      {
        title: "Data we process",
        body: [
          "Account data: name, email address, sign-in data.",
          "Data a company enters into the app: clients, orders, services, inventory, payments, documents and order photos.",
          "Technical data needed to run and secure the service (error logs, sign-in times).",
        ],
      },
      {
        title: "Google Drive",
        body: [
          "A company owner can connect their own Google Drive to store order photos and files. We request only the drive.file scope — access to files and folders created by the app — and the account email address. Other files in your Drive are not accessible to the app.",
          "This access is used only to save order photos into the “Core App” folder in your Drive, show them in the related order, and delete them when you delete the photo or the order.",
          "The access token is stored encrypted on the server and never sent to the browser. Google data is not sold, shared with third parties, used for advertising, or used to train AI models.",
          "Core App's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
          "You can disconnect Google Drive at any time in Settings → Storage, or revoke access at https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "Google Calendar",
        body: [
          "A company owner can connect Google Calendar so the team can manage a shared calendar inside Core App. We request calendar.events (read/write events), calendar.calendarlist.readonly (list calendars for selection), and the account email address.",
          "Only the calendar the owner explicitly selects is read and written (for example a dedicated “Workshop” calendar). Other Google calendars are not written by the app.",
          "The access token is stored encrypted on the server (Supabase Vault) and never sent to the browser. All Google Calendar API calls run on the server. Calendar data is not sold, shared with third parties, used for advertising, or used to train AI models.",
          "You can disconnect Google Calendar at any time in Calendar / Settings → Storage; disconnect revokes access at Google (best effort). You can also revoke at https://myaccount.google.com/permissions.",
        ],
      },
      {
        title: "How we use data",
        body: ["Only to operate the app and provide support. A company's data is visible only to its members according to their roles."],
      },
      {
        title: "Storage and deletion",
        body: [
          "Data is hosted by infrastructure providers (Supabase, Vercel) and, if the owner chooses, in their Google Drive, Google Calendar, or NAS.",
          "You can request an export or deletion of your data by contacting us.",
        ],
      },
      { title: "Contact", body: [`Privacy questions: ${PRIVACY_CONTACT_EMAIL}`] },
    ],
  },
};

export function PrivacyPolicyPage() {
  const { locale } = useParams();
  const lang = locale === "ro" || locale === "en" ? locale : "ru";
  const policy = POLICIES[lang];

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">{policy.title}</h1>
          <p className="text-sm text-muted-foreground">
            {policy.updated}: {UPDATED}
          </p>
          <nav className="flex gap-3 text-sm">
            <a className="underline" href="/ru/privacy">Русский</a>
            <a className="underline" href="/ro/privacy">Română</a>
            <a className="underline" href="/en/privacy">English</a>
          </nav>
        </header>
        <p className="leading-relaxed">{policy.intro}</p>
        {policy.sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
              {section.body.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </main>
  );
}
