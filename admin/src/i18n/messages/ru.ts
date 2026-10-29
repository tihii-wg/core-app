import type { Messages } from "./en";

const ru: Messages = {
  app: {
    brandName: "Core App",
    title: "Core App",
    subtitle: "Панель владельца SaaS",
    navAria: "Админ",
    logoAlt: "Логотип Core App",
  },
  nav: {
    overview: "Обзор",
    workspaces: "Рабочие пространства",
    subscriptions: "Подписки",
    security: "Безопасность и ограничения",
  },
  chrome: {
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    closeNavOverlay: "Закрыть навигацию",
    signOut: "Выйти",
    signedIn: "Вы вошли",
    demoMode: "Локальный UI-демо режим",
    language: "Язык",
    theme: "Тема",
    themeLight: "Светлая тема",
    themeDark: "Тёмная тема",
    localeEn: "English",
    localeRu: "Русский",
  },
  login: {
    title: "Core App",
    description:
      "Войдите через аккаунт Supabase Auth. Сама по себе аутентификация не даёт прав владельца SaaS — серверная авторизация platform-owner по-прежнему нужна для живых данных и мутаций.",
    email: "Email",
    password: "Пароль",
    submit: "Войти",
    submitting: "Вход…",
    signInFailed: "Не удалось войти",
    notConfigured:
      "Supabase не настроен. Скопируйте admin/.env.example в admin/.env и укажите только публичные VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Никогда не помещайте сюда service-role ключ.",
    continueDemo: "Продолжить с локальным UI-демо (без живых данных)",
    supabaseMissing:
      "Supabase не настроен. Скопируйте admin/.env.example в admin/.env и укажите только публичные anon-учётные данные.",
  },
  common: {
    search: "Поиск",
    status: "Статус",
    allStatuses: "Все статусы",
    allPlans: "Все тарифы",
    previous: "Назад",
    next: "Далее",
    view: "Открыть",
    open: "Открыть",
    manage: "Управление",
    cancel: "Отмена",
    backToWorkspaces: "К списку пространств",
    unknown: "Неизвестно",
    loading: "Загрузка…",
    demoPreviewBanner: "Предпросмотр макета — DEMO-фиктивные данные (не живые)",
    manageDisabledTitle: "Отключено: нет проверенного API админ-мутаций",
  },
  status: {
    trial: "Пробный",
    active: "Активна",
    expired: "Истекла",
    suspended: "Приостановлена",
    cancelled: "Отменена",
  },
  access: {
    writable: "Запись разрешена",
    "read-only": "Только чтение",
    unknown: "Неизвестно",
  },
  plan: {
    trial: "Пробный",
    starter: "Starter",
    professional: "Professional",
    enterprise: "Enterprise",
    unknown: "Неизвестно",
  },
  dataBanner: {
    liveTitle: "Живые данные админки",
    liveBody: "Строки пространств и подписок загружаются через проверенный серверный путь platform-owner.",
    unavailableTitle: "Живые данные между пространствами: НЕДОСТУПНЫ",
    demoNotReal:
      "Демо-фиктивные данные не показываются как реальные. Включайте предпросмотр макета только для проверки интерфейса.",
    showPreview: "Показать предпросмотр макета (demo)",
    hidePreview: "Скрыть предпросмотр макета",
    previewActiveTitle: "Активен предпросмотр макета — только DEMO-фиктивные данные.",
    previewActiveBody: "Эти строки вымышлены и не должны считаться записями подписок или пространств.",
    authzTitle: "Серверная авторизация только для владельца не включена",
    mutationsTitle: "Мутации безопасно отключены",
    mutationsBody:
      "Смена тарифа, срока и приостановка/возобновление отключены. soft_delete_workspace не используется (это удаление, а не приостановка). Интерфейс никогда не имитирует успешную запись.",
  },
  unavailable: {
    metricsTitle: "Живые метрики недоступны",
    workspacesTitle: "Живой список пространств недоступен",
    subscriptionsTitle: "Живые подписки недоступны",
    detailTitle: "Живая карточка пространства недоступна",
  },
  overview: {
    title: "Обзор",
    description:
      "Бизнес-метрики подписок рабочих пространств. Живые кросс-тенантные метрики требуют проверенного backend platform-owner.",
    totalWorkspacesDemo: "Всего пространств (demo)",
    activeSubsDemo: "Активные подписки (demo)",
    expiredSubsDemo: "Истекшие подписки (demo)",
    suspendedDemo: "Приостановленные пространства (demo)",
    statusDistribution: "Распределение по статусам (demo)",
    planDistribution: "Метки тарифов (demo)",
    planHint:
      "В отслеживаемых миграциях нет таблицы plans и plan_id. Метки ниже — вымышленные UI-заглушки.",
  },
  workspaces: {
    title: "Рабочие пространства",
    description:
      "Обзор пространств и подписок на бизнес-уровне. Записи клиентов, содержимое заказов и счета намеренно исключены.",
    searchPlaceholder: "Компания, владелец, email или ID пространства",
    searchAria: "Поиск demo-пространств",
    statusFilterAria: "Фильтр demo-строк по статусу подписки",
    searchDemo: "Поиск (demo)",
    emptyLiveTitle: "Нет живых пространств для отображения",
    emptyLiveBody:
      "Включайте «Показать предпросмотр макета (demo)» только чтобы проверить таблицу. Этот предпросмотр вымышлен и не является данными подписок.",
    emptyDemoTitle: "Нет подходящих demo-строк",
    emptyDemoBody: "Измените поиск или фильтры в предпросмотре макета.",
    showing: "Показано {{shown}} из {{total}} demo-строк предпросмотра",
    colCompany: "Компания",
    colOwner: "Владелец",
    colPlan: "Тариф (demo)",
    colStatus: "Статус",
    colExpires: "Истекает",
    colEmployees: "Сотрудники",
    colOrders: "Заказы",
    colAccess: "Доступ",
    colActions: "Действия",
  },
  subscriptions: {
    title: "Подписки",
    description:
      "Живое администрирование подписок заблокировано без backend platform-owner. Метки тарифов не определены в отслеживаемых миграциях.",
    planDemo: "Тариф (demo)",
    emptyLiveTitle: "Нет живых строк подписок",
    emptyLiveBody: "Включите предпросмотр макета только чтобы проверить фильтры и таблицу на вымышленных DEMO-строках.",
    emptyDemoTitle: "Нет подходящих demo-подписок",
    emptyDemoBody: "Попробуйте другой статус или тариф.",
    colWorkspace: "Пространство",
    colPlan: "Тариф",
    colStatus: "Статус",
    colStarted: "Начало",
    colExpires: "Истекает",
  },
  detail: {
    titleLive: "Карточка пространства",
    descriptionLive: "Живая карточка недоступна без backend platform-owner.",
    emptyLiveTitle: "Живая запись не загружена",
    emptyLiveBody:
      "Включите предпросмотр макета на предыдущей странице только чтобы проверить карточку с DEMO ID (например demo-ws-1001).",
    notFoundTitle: "DEMO-фиктивная запись не найдена",
    notFoundDescription: "Этот ID не является известной записью предпросмотра макета.",
    emptyUnknownTitle: "Неизвестное demo-пространство",
    emptyUnknownBody: "Вернитесь к списку, включите предпросмотр макета и откройте DEMO-строку.",
    demoTitleSuffix: "Предпросмотр DEMO — вымышленные бизнес-поля. Это не живая запись пространства.",
    sectionWorkspace: "Пространство (demo)",
    sectionSubscription: "Подписка (demo)",
    workspaceId: "ID пространства",
    companyName: "Название компании",
    ownerName: "Имя владельца",
    ownerEmail: "Email владельца",
    accessLabel: "Метка доступа",
    planLabel: "Метка тарифа (demo)",
    started: "Начало",
    expires: "Истекает",
    employees: "Сотрудники (demo-счётчик)",
    orders: "Заказы (demo-счётчик)",
    actionsTitle: "Административные действия",
    actionsBody:
      "Диалоги подтверждения — для проверки UX. Подтверждение остаётся отключённым до появления безопасного backend. Попытки вызывают клиент, который всегда отказывает и ничего не пишет.",
    changePlan: "Сменить тариф",
    changeExpiration: "Изменить срок",
    suspend: "Приостановить доступ",
    reactivate: "Возобновить доступ",
    previewPlan: "Предпросмотр диалога тарифа",
    previewExpiration: "Предпросмотр диалога срока",
    previewSuspend: "Предпросмотр диалога приостановки",
    previewReactivate: "Предпросмотр диалога возобновления",
    blockedReason:
      "Действие отключено. Нет проверенного API platform-owner, журнала аудита или (для приостановки) серверного ограничения доступа. soft_delete_workspace не вызывается. Интерфейс не имитирует успешное обновление.",
    unexpectedSuccess: "Неожиданный путь успеха — живой клиент мутаций не подключён.",
    planDialogTitle: "Сменить тариф подписки?",
    planDialogBody: "Текущий demo-тариф: {{plan}}. ID тарифов не определены в отслеживаемых миграциях, сохранить нельзя.",
    planDialogConfirm: "Сохранить тариф",
    proposedPlan: "Предлагаемая метка тарифа (demo)",
    expirationDialogTitle: "Изменить срок подписки?",
    expirationDialogBody: "Текущий срок: {{date}}. Проверенного admin RPC обновления нет.",
    expirationDialogConfirm: "Сохранить срок",
    proposedExpiry: "Предлагаемая дата окончания",
    suspendDialogTitle: "Приостановить доступ к пространству?",
    suspendDialogBody:
      "Заблокировало бы запись в Core App без удаления данных и Auth-аккаунта владельца. Приостановка сегодня не enforced на сервере. soft_delete_workspace — другое, разрушающее soft-delete и здесь не используется.",
    suspendDialogConfirm: "Приостановить",
    reactivateDialogTitle: "Возобновить доступ к пространству?",
    reactivateDialogBody: "Восстановило бы доступ после приостановки. Проверенного API возобновления пока нет.",
    reactivateDialogConfirm: "Возобновить",
  },
  security: {
    title: "Безопасность и ограничения",
    description:
      "Проверенные выводы по репозиторию. Наличие UI не означает готовность функции. Панель не готова к продакшену для живого администрирования SaaS.",
    capabilityTitle: "Флаги возможностей (клиент админки)",
    capabilityCol: "Возможность",
    statusCol: "Статус",
    available: "Доступно",
    blocked: "Заблокировано / нет backend",
    findingsTitle: "Результаты проверки Phase 1",
    findingsHint: "Только из миграций и исходников Core App — без удалённого SQL.",
    prerequisitesTitle: "Минимальные предпосылки (не реализовывать в этой frontend-only задаче)",
    recommendedTitle: "Рекомендуемый дизайн backend позже",
    caps: {
      listAllWorkspaces: "Кросс-тенантный список пространств",
      aggregateCounts: "Безопасные агрегатные счётчики",
      platformOwnerAuthz: "Авторизация platform-owner",
      changePlan: "Смена тарифа",
      changeExpiration: "Изменение срока",
      suspendWorkspace: "Приостановка доступа",
      reactivateWorkspace: "Возобновление доступа",
      auditLog: "Журнал аудита админа",
    },
    findingStatus: {
      present: "есть",
      partial: "частично",
      missing: "нет",
      "frontend-only": "только frontend",
    },
  },
  findings: {
    "auth-session": {
      area: "Аутентификация",
      summary:
        "Браузерный клиент Supabase использует anon-ключ; сессия через getSession/signInWithPassword/onAuthStateChange.",
    },
    "workspace-ownership": {
      area: "Владение пространством",
      summary:
        "workspaces.owner_id + workspace_members.role='owner'; RLS insert/update для владельца; soft_delete_workspace проверяет владельца.",
    },
    "workspace-list-rls": {
      area: "Список пространств (RLS)",
      summary:
        "SELECT по workspaces ограничен владельцем (и member-read миграцией). Нет кросс-тенантного пути для platform owner.",
    },
    "subscription-columns": {
      area: "Схема подписки",
      summary:
        "Клиент Core App читает subscription_status / started / expires / updated с откатом, если колонок нет. В отслеживаемых миграциях этих колонок и таблицы plans нет.",
    },
    "subscription-gating": {
      area: "Ограничение доступа",
      summary:
        "hasSubscriptionWriteEntitlement ограничивает запись в SPA. В миграциях нет RLS/RPC по subscription_status. Soft-delete — не приостановка.",
    },
    "edge-functions": {
      area: "Доверенный серверный код",
      summary: "В репозитории нет каталога supabase/functions и HTTP API platform-admin.",
    },
    "platform-admin": {
      area: "Авторизация platform-owner",
      summary: "Нет is_platform_admin, проверки app_metadata role или SECURITY DEFINER admin RPC для владельца SaaS.",
    },
    "admin-mutations": {
      area: "Мутации подписки",
      summary: "Нет RPC/API смены тарифа, срока или статуса. Приложение не пишет subscription_*. В схеме нет plan ID.",
    },
    suspend: {
      area: "Приостановка / возобновление",
      summary:
        "Нет API приостановки/возобновления. soft_delete_workspace мягко удаляет пространство — это не обратимая приостановка доступа.",
    },
    audit: {
      area: "Аудит",
      summary: "В отслеживаемых миграциях нет audit_log / activity_log или admin audit RPC.",
    },
    "order-count": {
      area: "Агрегатные счётчики",
      summary:
        "getOrdersPage поддерживает count:exact для одного доступного пространства. Сотрудники загружаются полностью. Нет кросс-тенантного admin RPC агрегатов.",
    },
    "tenant-rpcs": {
      area: "Существующие RPC (тенант)",
      summary:
        "Проверенные RPC ограничены пространством (участники, soft_delete, склад, нумерация счетов) — это не поверхности platform-admin.",
    },
  },
  prerequisites: {
    "platform-admin": {
      title: "Авторизация platform-owner",
      detail:
        "Добавьте серверную проверку (SECURITY DEFINER RPC или Edge Function), которая подтверждает владельца SaaS через неподделываемый claim (например auth app_metadata). Клиентские проверки email отклоняются.",
    },
    "cross-tenant-list": {
      title: "Кросс-тенантный список пространств",
      detail:
        "Текущий RLS: владельцы и участники видят только свои пространства (baseline + 20260929000100). getUserWorkspaces фильтрует membership по auth user. Нужен привилегированный аудируемый запрос только бизнес-полей.",
    },
    aggregates: {
      title: "Безопасные агрегатные счётчики",
      detail:
        "Тенантный getOrdersPage поддерживает count:exact для доступных пространств; сотрудники загружаются полностью. Нужны admin RPC-агрегаты без PII клиентов, тел заказов и счетов.",
    },
    "subscription-mutations": {
      title: "RPC мутаций подписки",
      detail:
        "Нет admin-записи subscription_*. Нет таблицы plans/plan_id в отслеживаемых миграциях. Нужны валидируемые, авторизованные, идемпотентные серверные эндпоинты до включения подтверждений в UI.",
    },
    suspension: {
      title: "Серверная приостановка",
      detail:
        "Ограничение записи в SPA — только frontend. soft_delete_workspace мягко удаляет пространство — не использовать как suspend. Нужны статус + RLS/триггеры для защищённых операций и возобновление.",
    },
    audit: {
      title: "Журнал аудита админа",
      detail:
        "В отслеживаемых миграциях нет audit_log (или аналога). Не включайте админ-мутации без аудита actor/action/workspace/before-after.",
    },
  },
  recommended: {
    claim: {
      title: "1. Claim platform-owner (только сервер)",
      detail:
        "Храните неподделываемый флаг platform-owner в auth.users raw_app_meta_data (только через service role / dashboard) или SECURITY DEFINER is_platform_owner(). Никогда не доверяйте сравнению email в браузере.",
    },
    listRpc: {
      title: "2. Read RPC: admin_list_workspaces()",
      detail:
        "SECURITY DEFINER, EXECUTE для authenticated, первая строка — отказ без is_platform_owner(). Возвращать только бизнес-поля: id/имя пространства, имя/email владельца, статус/даты подписки, число сотрудников и заказов. Без PII клиентов, тел заказов, VIN, счетов.",
    },
    mutations: {
      title: "3. Mutation RPC с аудитом",
      detail:
        "admin_set_subscription(workspace_id, status, expires_at) и (только после реальной модели тарифов) admin_set_plan(...). Валидация переходов, требование platform owner, запись в admin_audit_log (actor, action, workspace_id, before/after, timestamp).",
    },
    suspension: {
      title: "4. Серверная приостановка",
      detail:
        "Когда subscription_status станет авторитетным в БД, добавьте RLS или триггеры, чтобы suspended/expired пространства не могли мутировать защищённые таблицы. Одного frontend-гейта недостаточно.",
    },
    frontend: {
      title: "5. Интеграция frontend админки",
      detail:
        "Вызывайте RPC с JWT пользователя (anon-ключ). Флаги в admin/src/data/capabilities.ts включайте только после проверки RPC. Без service-role в Vite.",
    },
  },
  auth: {
    platformOwnerReason:
      "Одной только личности входа недостаточно. Панель не выдаёт права владельца SaaS, пока нет серверной проверки platform-owner. Текущий RLS возвращает только пространства, которыми вы владеете или в которых состоите.",
  },
  liveData: {
    unavailableReason:
      "Кросс-тенантные админ-данные нельзя загрузить безопасно: RLS возвращает только пространства владельца/участника, а RPC/Edge Function platform-owner отсутствует. Админка не будет запрашивать чужие тенанты через публичный anon-клиент.",
    capabilityTrueButUnwired: "Флаги возможностей включены, но живая интеграция ещё не подключена.",
  },
  mutations: {
    disabled:
      "Мутация отключена. Нет проверенного RPC platform-owner для тарифа, срока или приостановки. soft_delete_workspace — не API приостановки и не будет вызван.",
    unsupported: "Флаги возможностей включены, но клиент мутаций ещё не реализован.",
  },
};

export default ru;
