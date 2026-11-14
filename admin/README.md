# Core App Admin

Standalone SaaS-owner panel for Core App (separate Vite + React app in `admin/`, same repo).

## What it does

- **Overview** — workspace counts by subscription status, new workspaces, orders in 30 days, subscriptions expiring soon.
- **Workspaces** — all workspaces with owner, subscription status/expiry, resulting access, users, orders; search, filters, sorting.
- **Workspace page** — details, users with last sign-in, aggregates, subscription editor (status, end date, +1/+3/+12 months, unlimited, suspend/reactivate) and its change history.
- **Audit log** — every subscription change made in the panel (who, when, before → after, comment).

No client PII or order contents are read — only workspace/owner/member names and emails plus counts.

## Backend

Apply `supabase/manual/20261116110000_platform_admin.PRODUCTION.sql` on the Supabase project, then grant yourself access:

```sql
insert into public.platform_admins (user_id, note)
select id, 'owner' from auth.users where lower(email) = lower('YOUR_EMAIL')
on conflict do nothing;
```

All `admin_*` RPCs are `SECURITY DEFINER` and reject anyone not in `public.platform_admins`; the panel uses only the public anon key plus the signed-in user's session. Never put a service-role key into `admin/.env`.

Note: suspension/expiry is enforced by the Core App client (the workspace switches to read-only); it is not yet enforced by RLS on every table.

## Local run

```bash
cd admin
npm install
cp .env.example .env   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (same public values as the root app)
npm run dev            # http://localhost:5174
```

Scripts: `dev`, `build`, `preview` (port 4174), `typecheck`.
