# Core App Admin

Standalone SaaS-owner admin panel for the Core App business. Lives in `admin/` inside the same `tihii-wg/core-app` Git repository as the customer-facing app. Separate Vite + React + TypeScript application (own entry point, dependencies, build output). **Not** linked from the Core App SPA.

**This panel is not production-ready for live SaaS administration.** Live cross-workspace data and mutations are unavailable until trusted backend work exists.

## Real-data integration status

| Area | Status |
|------|--------|
| Live cross-tenant workspace list | **Unavailable** — RLS is owner/member scoped; no platform-owner RPC |
| Owner name/email for all tenants | **Unavailable** — would require privileged read path |
| Subscription plan | **Unavailable** — no `plans` / `plan_id` in tracked migrations |
| Subscription status / expiration | **Partial in Core App client** (reads with fallback) — **not** exposed cross-tenant to admin |
| Employee / order counts (admin) | **Unavailable** cross-tenant; tenant `orders` page supports `count: exact` only for accessible workspaces |
| Demo fixtures | Optional **layout preview only** (off by default); never presented as live data |

The admin data layer (`src/data/workspaceAdminApi.ts`) **does not** query other tenants via the anon client. That would either return only the caller’s memberships (misleading) or fail under RLS.

## Owner authorization — how it works (or why not)

1. Optional Supabase Auth sign-in with the **anon** key (same public credentials model as Core App).
2. `isPlatformOwner` in the admin client is **hard-coded `false`**.
3. No email allowlist, no client-side “secret” role, no service-role key.
4. Signing in does **not** unlock live admin data or mutations.

**Missing:** server-enforced platform-owner check (e.g. `app_metadata` claim + `SECURITY DEFINER` RPC or Edge Function). See in-app **Security & limits** and `src/data/backendFindings.ts`.

## Administrative actions

| Action | Functional? |
|--------|-------------|
| Change plan | **Disabled** — no plan model / admin RPC |
| Change expiration | **Disabled** — no admin write path for `subscription_*` |
| Suspend access | **Disabled** — no server-enforced suspension; Core App gating is frontend-only |
| Reactivate access | **Disabled** |
| soft_delete_workspace | **Not used** — soft-deletes workspace; not reversible “suspend” |

Confirm dialogs exist for UX review; confirm buttons stay disabled. Mutation helper always refuses writes.

## Minimum backend prerequisites (later; not in this task)

1. Platform-owner authorization on the server (non-forgeable claim or equivalent).
2. `admin_list_workspaces()` (or Edge Function) returning **business fields only** + aggregates.
3. Mutation RPCs for status/expiration (and plan only after a real plan model).
4. RLS/triggers so suspended/expired workspaces cannot mutate protected data.
5. `admin_audit_log` (or equivalent) before enabling mutations.

Do **not** implement those as migrations/SQL from the admin frontend task. Documented design lives in `src/data/backendFindings.ts` (`recommendedBackendDesign`).

## Branding

Matches the customer-facing Core App:

- Product name: **Core App** (`common.appName` / browser `<title>Core App</title>`).
- Logo & favicon: `admin/public/core-app-logo.svg` (exact copy of root `public/core-app-logo.svg`).
- Typography: Inter Variable (`@fontsource-variable/inter`), same stack as Core App `globals.css`.

## Language and theme

- **Languages:** English (default) and Russian (`Русский`), via a header/login locale select.
- **Theme:** Light (default) and Dark, via a sun/moon toggle next to the language control.
- Preferences persist in `localStorage` (`core-app-admin-locale`, `core-app-admin-theme`).
- `document.documentElement.lang` and `data-theme` update immediately; an inline script in `index.html` applies saved theme/lang before paint to reduce flash.
- UI copy lives in typed dictionaries: `src/i18n/messages/en.ts` and `ru.ts` (no extra i18n library).

## Ports & local development

| App | Command | Default URL | Port behavior |
|-----|---------|-------------|---------------|
| Core App (repo root) | `npm run dev` | `http://localhost:5173` | Vite default |
| Admin (`admin/`) | `npm run dev` | `http://localhost:5174` | **strictPort: true** |
| Admin preview | `npm run preview` | `http://localhost:4174` | strictPort: true |

### Core App

```bash
npm install
npm run dev
```

### Admin

```bash
cd admin
npm install
cp .env.example .env   # optional; public anon vars only — never service-role
npm run dev
```

Without `.env`, use **Continue with local UI demo** on the login screen to review chrome. That mode is not Supabase-authenticated and does not unlock live data.

Scripts: `dev`, `build`, `preview`, `typecheck`.

## Environment

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` only (or unprefixed public aliases mapped in `vite.config.ts`).  
**Never** put a service-role key in Vite env or the browser bundle.

## Git / Source Control

- No nested Git repo under `admin/`.
- Changes appear with Core App in the same VS Code Source Control view.
- Commit/push does **not** auto-deploy either app.

## Future independent hosting (not done now)

1. New Vercel project → same Git repository.
2. Root Directory = `admin`.
3. Public Supabase env vars only.
4. Admin gets its own URL.

Hosting does **not** replace backend authorization.

## Privacy

Admin UI targets workspace/subscription-level fields only. It must not fetch client PII, order contents, VINs, notes, attachments, or invoice/payment details. Until a purpose-built admin read API exists, live lists stay unavailable rather than over-fetching tenant tables.
