# Core App — Supabase project roles

**Permanent assignments.** Do not delete either project. Do not assume the Supabase CLI link matches the app `.env`.

| Role | Project ID (ref) | Dashboard name (when linked) | Purpose |
| --- | --- | --- | --- |
| **MAIN / ACTIVE** | `pundggjzzaqzbvykbxvo` | (primary Core App project) | **Only project for the current development phase.** Local app `.env` (`VITE_SUPABASE_URL`) points here. Authoritative Production release target. |
| **TEST (inactive for now)** | `hnfvrlgcnpykncixxqha` | `core-app-test` | **Preserve.** Reserved for a future testing phase after required features are implemented. Do not connect, switch CLI to it, use credentials, or run SQL against it until the owner explicitly authorizes the testing phase. |

## Current phase: fast development (MAIN only)

- Implement features in Core App using MAIN.
- Do **not** start a TEST workflow, create a separate TEST environment, or delay work for unnecessary testing procedures.
- Do **not** execute remote SQL/migrations, deploy, or commit/push unless the owner explicitly asks.
- Prepare SQL scripts locally when needed; apply them remotely only with permission.
- Leave TEST project references in the repo intact but inactive.

## What points where (local machine)

| Source | Current target | Notes |
| --- | --- | --- |
| Root `.env` → `VITE_SUPABASE_URL` | **MAIN** `pundggjzzaqzbvykbxvo` | Runtime for `npm run dev` / Vite builds. Do not change unless authorized. |
| `.env.test.local` (gitignored) | **TEST** `hnfvrlgcnpykncixxqha` | Optional leftover for `npm run test:supabase`. **Do not use during the current phase.** Hosted scripts refuse Production refs — still leave unused until testing is authorized. |
| `supabase/.temp/project-ref` and `linked-project.json` | **TEST** `hnfvrlgcnpykncixxqha` | Local Supabase CLI link cache (historically committed). **Not** the app runtime. Do not relink “for cleanliness.” Do not run CLI db commands that would hit this link during development. |
| `supabase/config.toml` | *(absent in this repo)* | No project_id in-repo config file. |

### Why the CLI and `.env` differ

The Vite app uses `.env` → MAIN.  
A past `supabase link` associated this working copy with TEST (`core-app-test`) under `supabase/.temp/`. That does **not** redirect the browser app.

**Never** run SQL, `db push`, migrations, or Dashboard actions based only on the CLI link. Always verify the Project ID in the Dashboard URL / script header first. During the current phase, do not target TEST at all.

## Future testing phase (owner-authorized only)

When (and only when) the owner explicitly starts testing:

1. Use TEST `hnfvrlgcnpykncixxqha` for rehearsals as instructed.
2. Confirm Project ID in the Dashboard before every remote operation.
3. Do not mix MAIN and TEST credentials.
4. Prefer rehearsing on TEST before any authorized MAIN apply.

See also: `supabase/manual/MIGRATION_CUTOVER.md`, `.cursor/rules/dev-environment.mdc`.
