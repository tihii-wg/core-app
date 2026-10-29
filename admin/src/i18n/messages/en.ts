const en = {
  app: {
    brandName: "Core App",
    title: "Core App",
    subtitle: "SaaS owner panel",
    navAria: "Admin",
    logoAlt: "Core App logo",
  },
  nav: {
    overview: "Overview",
    workspaces: "Workspaces",
    subscriptions: "Subscriptions",
    security: "Security & limits",
  },
  chrome: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    closeNavOverlay: "Close navigation overlay",
    signOut: "Sign out",
    signedIn: "Signed in",
    demoMode: "Local UI demo mode",
    language: "Language",
    theme: "Theme",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    localeEn: "English",
    localeRu: "Русский",
  },
  login: {
    title: "Core App",
    description:
      "Sign in with a Supabase Auth account. Authentication alone does not grant SaaS-owner privileges — backend platform-owner authorization is still required before live admin data or mutations are available.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    signInFailed: "Sign-in failed",
    notConfigured:
      "Supabase is not configured. Copy admin/.env.example to admin/.env and set public VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY only. Never put a service-role key here.",
    continueDemo: "Continue with local UI demo (no live data)",
    supabaseMissing:
      "Supabase is not configured. Copy admin/.env.example to admin/.env and set public anon credentials only.",
  },
  common: {
    search: "Search",
    status: "Status",
    allStatuses: "All statuses",
    allPlans: "All plans",
    previous: "Previous",
    next: "Next",
    view: "View",
    open: "Open",
    manage: "Manage",
    cancel: "Cancel",
    backToWorkspaces: "Back to workspaces",
    unknown: "Unknown",
    loading: "Loading…",
    demoPreviewBanner: "Layout preview — DEMO fixtures (not live data)",
    manageDisabledTitle: "Disabled: no verified admin mutation API",
  },
  status: {
    trial: "Trial",
    active: "Active",
    expired: "Expired",
    suspended: "Suspended",
    cancelled: "Cancelled",
  },
  access: {
    writable: "Writable",
    "read-only": "Read-only",
    unknown: "Unknown",
  },
  plan: {
    trial: "Trial",
    starter: "Starter",
    professional: "Professional",
    enterprise: "Enterprise",
    unknown: "Unknown",
  },
  dataBanner: {
    liveTitle: "Live admin data",
    liveBody: "Workspace and subscription rows are loaded through a verified platform-owner backend path.",
    unavailableTitle: "Live cross-workspace data: UNAVAILABLE",
    demoNotReal:
      "Demo fixtures are not shown as real data. Enable layout preview only to review UI chrome.",
    showPreview: "Show layout preview (demo)",
    hidePreview: "Hide layout preview",
    previewActiveTitle: "Layout preview active — DEMO fixtures only.",
    previewActiveBody: "These rows are fictional and must not be treated as subscription or workspace records.",
    authzTitle: "Owner-only backend authorization is not enforced",
    mutationsTitle: "Mutations are safely disabled",
    mutationsBody:
      "Plan changes, expiration edits, and suspend/reactivate stay disabled. soft_delete_workspace is not used (it deletes, it does not suspend). The UI never fakes a successful write.",
  },
  unavailable: {
    metricsTitle: "Live metrics unavailable",
    workspacesTitle: "Live workspace list unavailable",
    subscriptionsTitle: "Live subscriptions unavailable",
    detailTitle: "Live workspace detail unavailable",
  },
  overview: {
    title: "Overview",
    description:
      "Business-level SaaS metrics for workspace subscriptions. Live cross-tenant metrics require a verified platform-owner backend.",
    totalWorkspacesDemo: "Total workspaces (demo)",
    activeSubsDemo: "Active subscriptions (demo)",
    expiredSubsDemo: "Expired subscriptions (demo)",
    suspendedDemo: "Suspended workspaces (demo)",
    statusDistribution: "Status distribution (demo)",
    planDistribution: "Demo plan labels",
    planHint:
      "Tracked migrations do not define a plans table or plan_id. Labels below are fictional UI placeholders.",
  },
  workspaces: {
    title: "Workspaces",
    description:
      "Business-level workspace and subscription overview. Customer records, order contents, and invoice details are intentionally excluded.",
    searchPlaceholder: "Company, owner, email, or workspace ID",
    searchAria: "Search demo workspaces",
    statusFilterAria: "Filter demo rows by subscription status",
    searchDemo: "Search (demo)",
    emptyLiveTitle: "No live workspaces to display",
    emptyLiveBody:
      "Turn on “Show layout preview (demo)” above only if you need to review table layout. That preview is fictional and is not subscription data.",
    emptyDemoTitle: "No matching demo rows",
    emptyDemoBody: "Adjust search or filters in the layout preview.",
    showing: "Showing {{shown}} of {{total}} demo preview rows",
    colCompany: "Company",
    colOwner: "Owner",
    colPlan: "Plan (demo)",
    colStatus: "Status",
    colExpires: "Expires",
    colEmployees: "Employees",
    colOrders: "Orders",
    colAccess: "Access",
    colActions: "Actions",
  },
  subscriptions: {
    title: "Subscriptions",
    description:
      "Live subscription administration is blocked without platform-owner backend support. Plan labels are not defined in tracked migrations.",
    planDemo: "Plan (demo)",
    emptyLiveTitle: "No live subscription rows",
    emptyLiveBody: "Enable layout preview only to inspect filters and table chrome with fictional DEMO rows.",
    emptyDemoTitle: "No matching demo subscriptions",
    emptyDemoBody: "Try another status or plan filter.",
    colWorkspace: "Workspace",
    colPlan: "Plan",
    colStatus: "Status",
    colStarted: "Started",
    colExpires: "Expires",
  },
  detail: {
    titleLive: "Workspace detail",
    descriptionLive: "Live workspace detail is unavailable without a platform-owner backend.",
    emptyLiveTitle: "No live record loaded",
    emptyLiveBody:
      "Enable layout preview on a previous page only if you need to review the detail layout with a DEMO fixture ID (for example demo-ws-1001).",
    notFoundTitle: "Demo fixture not found",
    notFoundDescription: "This ID is not a known layout-preview fixture.",
    emptyUnknownTitle: "Unknown demo workspace",
    emptyUnknownBody: "Return to Workspaces, enable layout preview, and open a listed DEMO row.",
    demoTitleSuffix: "DEMO layout preview — fictional business-level fields only. Not a live workspace record.",
    sectionWorkspace: "Workspace (demo)",
    sectionSubscription: "Subscription (demo)",
    workspaceId: "Workspace ID",
    companyName: "Company name",
    ownerName: "Owner name",
    ownerEmail: "Owner email",
    accessLabel: "Access label",
    planLabel: "Plan label (demo)",
    started: "Started",
    expires: "Expires",
    employees: "Employees (demo count)",
    orders: "Orders (demo count)",
    actionsTitle: "Administrative actions",
    actionsBody:
      "Confirmation dialogs are for UX review. Confirm remains disabled until a secure backend exists. Attempts call a hard-failing client that never writes.",
    changePlan: "Change plan",
    changeExpiration: "Change expiration",
    suspend: "Suspend access",
    reactivate: "Reactivate access",
    previewPlan: "Preview plan dialog",
    previewExpiration: "Preview expiration dialog",
    previewSuspend: "Preview suspend dialog",
    previewReactivate: "Preview reactivate dialog",
    blockedReason:
      "This action is disabled. No verified platform-owner mutation API, audit log, or (for suspension) server-enforced access gate exists. soft_delete_workspace will not be called. The UI will not fake a successful update.",
    unexpectedSuccess: "Unexpected success path — no live mutation client is wired.",
    planDialogTitle: "Change subscription plan?",
    planDialogBody: "Current demo plan: {{plan}}. Plan IDs are not defined in tracked migrations, so this cannot be saved.",
    planDialogConfirm: "Save plan",
    proposedPlan: "Proposed demo plan label",
    expirationDialogTitle: "Change subscription expiration?",
    expirationDialogBody: "Current expiration: {{date}}. No verified admin update RPC exists.",
    expirationDialogConfirm: "Save expiration",
    proposedExpiry: "Proposed expiration date",
    suspendDialogTitle: "Suspend workspace access?",
    suspendDialogBody:
      "Would block Core App writes without deleting data or the owner's Auth account. Suspension is not server-enforced today. soft_delete_workspace is a different, destructive soft-delete and is not used here.",
    suspendDialogConfirm: "Suspend",
    reactivateDialogTitle: "Reactivate workspace access?",
    reactivateDialogBody: "Would restore access after a suspension. No verified reactivate API exists yet.",
    reactivateDialogConfirm: "Reactivate",
  },
  security: {
    title: "Security & limits",
    description:
      "Verified repository findings. Features are not marked complete merely because UI exists. This panel is not production-ready for live SaaS administration.",
    capabilityTitle: "Capability flags (admin client)",
    capabilityCol: "Capability",
    statusCol: "Status",
    available: "Available",
    blocked: "Blocked / missing backend",
    findingsTitle: "Phase 1 inspection findings",
    findingsHint: "From migrations and Core App source only — no remote SQL.",
    prerequisitesTitle: "Minimum prerequisites (do not implement in this frontend-only task)",
    recommendedTitle: "Recommended later backend design",
    caps: {
      listAllWorkspaces: "Cross-tenant workspace list",
      aggregateCounts: "Safe aggregate counts",
      platformOwnerAuthz: "Platform-owner authorization",
      changePlan: "Change plan",
      changeExpiration: "Change expiration",
      suspendWorkspace: "Suspend workspace access",
      reactivateWorkspace: "Reactivate workspace access",
      auditLog: "Admin audit log",
    },
    findingStatus: {
      present: "present",
      partial: "partial",
      missing: "missing",
      "frontend-only": "frontend-only",
    },
  },
  findings: {
    "auth-session": {
      area: "Authentication",
      summary:
        "Browser Supabase client uses anon key; session via getSession/signInWithPassword/onAuthStateChange.",
    },
    "workspace-ownership": {
      area: "Workspace ownership",
      summary:
        "workspaces.owner_id + workspace_members.role='owner'; RLS update/insert owner-scoped; soft_delete_workspace owner-checked.",
    },
    "workspace-list-rls": {
      area: "Workspace listing (RLS)",
      summary:
        "SELECT on workspaces is limited to owner (and member read migration). No cross-tenant list path for platform owners.",
    },
    "subscription-columns": {
      area: "Subscription schema",
      summary:
        "Core App client reads subscription_status / started / expires / updated with graceful fallback if columns missing. Tracked migrations do not define these columns or a plans table.",
    },
    "subscription-gating": {
      area: "Access gating",
      summary:
        "hasSubscriptionWriteEntitlement gates writes in the SPA. No RLS/RPC in migrations references subscription_status. Soft-delete is not suspension.",
    },
    "edge-functions": {
      area: "Trusted server code",
      summary: "No supabase/functions Edge Functions directory or platform-admin HTTP API in the repository.",
    },
    "platform-admin": {
      area: "Platform-owner authorization",
      summary: "No is_platform_admin helper, app_metadata role check, or SECURITY DEFINER admin RPC for SaaS owner.",
    },
    "admin-mutations": {
      area: "Subscription mutations",
      summary: "No RPC/API to change plan, expiration, or status. App never writes subscription_* fields. No plan IDs in schema.",
    },
    suspend: {
      area: "Suspend / reactivate",
      summary:
        "No suspend/reactivate API. soft_delete_workspace soft-deletes the workspace — not a reversible access suspension and must not be used as one.",
    },
    audit: {
      area: "Audit logging",
      summary: "No audit_log / activity_log table or admin audit RPC in tracked migrations.",
    },
    "order-count": {
      area: "Aggregate counts",
      summary:
        "getOrdersPage supports count:exact for a single workspace the caller can access. Employees are full-fetched. No cross-tenant aggregate admin RPC.",
    },
    "tenant-rpcs": {
      area: "Existing RPCs (tenant-scoped)",
      summary:
        "Verified RPCs are workspace-scoped (members, soft_delete, warehouse materials, invoice numbering) — not platform-admin surfaces.",
    },
  },
  prerequisites: {
    "platform-admin": {
      title: "Platform-owner authorization",
      detail:
        "Add a server-enforced check (SECURITY DEFINER RPC or Edge Function) that verifies the caller is the SaaS owner via a non-forgeable claim (e.g. auth app_metadata). Client-side email checks are rejected.",
    },
    "cross-tenant-list": {
      title: "Cross-tenant workspace listing",
      detail:
        "Existing RLS: owners + members can SELECT their workspaces only (baseline + 20260929000100). getUserWorkspaces filters membership by auth user. Need a privileged, audited query returning business-level fields only.",
    },
    aggregates: {
      title: "Safe aggregate counts",
      detail:
        "Tenant getOrdersPage supports count:exact for accessible workspaces; employees are full-fetched. Need admin RPC aggregates that never return customer PII, order bodies, or invoices.",
    },
    "subscription-mutations": {
      title: "Subscription mutation RPCs",
      detail:
        "No admin write path for subscription_*. No plans table/plan_id in tracked migrations. Need validated, authorized, idempotent server endpoints before enabling UI confirms.",
    },
    suspension: {
      title: "Server-enforced suspension",
      detail:
        "SPA write gating is frontend-only. soft_delete_workspace soft-deletes a workspace — do not reuse it as suspend. Need status + RLS/triggers for protected operations, plus reactivate.",
    },
    audit: {
      title: "Admin audit log",
      detail:
        "No audit_log (or equivalent) in tracked migrations. Do not enable administrative mutations without actor/action/workspace/before-after auditability.",
    },
  },
  recommended: {
    claim: {
      title: "1. Platform-owner claim (server-only)",
      detail:
        "Store a non-forgeable platform-owner flag in auth.users raw_app_meta_data (set only via service role / dashboard), or a SECURITY DEFINER function is_platform_owner() that reads that claim. Never trust email comparisons in the browser.",
    },
    listRpc: {
      title: "2. Read RPC: admin_list_workspaces()",
      detail:
        "SECURITY DEFINER, grant execute to authenticated, first line reject unless is_platform_owner(). Return only business fields: workspace id/name, owner name/email, subscription status/dates, employee count, order count. No client PII, order bodies, VINs, invoices.",
    },
    mutations: {
      title: "3. Mutation RPCs with audit",
      detail:
        "admin_set_subscription(workspace_id, status, expires_at) and (only after a real plan model exists) admin_set_plan(...). Validate transitions, require platform owner, write an admin_audit_log row (actor, action, workspace_id, before/after, timestamp).",
    },
    suspension: {
      title: "4. Server-enforced suspension",
      detail:
        "Once subscription_status is authoritative in the DB, add RLS or trigger checks so suspended/expired workspaces cannot mutate protected tables. Frontend gating alone is insufficient.",
    },
    frontend: {
      title: "5. Admin frontend integration",
      detail:
        "Call the RPCs with the user's anon-key session JWT. Capability flags in admin/src/data/capabilities.ts flip to true only after those RPCs exist and are verified. No service-role key in Vite.",
    },
  },
  auth: {
    platformOwnerReason:
      "Signed-in identity alone is not enough. This panel does not grant SaaS-owner privileges until a server-side platform-owner authorization check exists. Existing RLS only returns workspaces you own or belong to.",
  },
  liveData: {
    unavailableReason:
      "Cross-workspace admin data cannot be loaded securely: existing RLS only returns workspaces the signed-in user owns or belongs to, and no platform-owner RPC/Edge Function exists. The admin app will not query other tenants through the public anon client.",
    capabilityTrueButUnwired: "Capability flags are true but no live integration is wired yet.",
  },
  mutations: {
    disabled:
      "This mutation is disabled. No verified platform-owner RPC exists for plan, expiration, or suspension changes. soft_delete_workspace is not a suspend API and will not be called.",
    unsupported: "Capability flags enabled but mutation client is not implemented yet.",
  },
} as const;

export default en;

/** Deep string shape so locale catalogs can differ in wording while matching keys. */
export type Messages = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : MessagesLeaf<(typeof en)[K]>;
};

type MessagesLeaf<T> = {
  [K in keyof T]: T[K] extends string ? string : MessagesLeaf<T[K]>;
};
