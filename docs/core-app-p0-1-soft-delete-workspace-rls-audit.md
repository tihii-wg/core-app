# P0.1 Soft-Deleted Workspace RLS — Final Security Review

**Audit date:** 2026-11-01 (final review pass)  
**Scope:** Repository evidence only.  
**MAIN apply state:** **UNVERIFIED**.  
**TEST:** Not accessed.  
**This document supersedes earlier severity wording where corrected below.**

---

## 1. Final executive summary

| Item | Final classification |
| --- | --- |
| `crm_permitted_workspaces(text)` missing `workspaces.deleted_at` | **CONFIRMED — must fix** (crm_ro_v1 RLS helper defect) |
| Prepared patch `20261101010000_…deleted_at.PRODUCTION.sql` | **Correct and safe to prepare for MAIN** after preflight (function replace, not table/policy DDL) |
| `workspace_member_can_manage(uuid, uuid)` missing `w.deleted_at` | **DEFENSE-IN-DEPTH** — **not exploitable** by `authenticated` in repo (unused in RLS; EXECUTE only `service_role`) |
| `soft_delete_workspace` “partial commit” window | **NOT CONFIRMED** — no reproducible partial-commit path; both UPDATEs share one function transaction |
| Logo Storage (intended `20260929000400`) | **DEFENSE-IN-DEPTH / UNVERIFIED apply** — helpers already exclude deleted WS/members |
| Order-attachments Storage | **UNVERIFIED** (manual SQL; apply state unknown) |
| Payments RLS | **UNVERIFIED** (no policy DDL in migrations) |
| MAIN deployment of 2.1a / helpers | **UNVERIFIED** |
| `FORCE ROW LEVEL SECURITY` | **UNVERIFIED** on MAIN; **absent** from repository SQL |

**Normal soft-delete path:** hardened `soft_delete_workspace` soft-deletes the workspace **and** all members in one invocation. That mitigates exposure of the unpatched CRM helper under routine app use. The CRM helper is still **wrong** relative to baseline helpers and remains a **confirmed** defect for any state where memberships stay active on a soft-deleted workspace (service-role edits, inconsistent data, future writers).

**Primary remediation:** after MAIN preflight, apply cutover **2.1a** only. Do not treat unrelated hardenings as blockers.

---

## 2. `workspace_member_can_manage` — definition and usage inventory

### 2.1 Overload A — used by RLS (uuid, text)

```text
public.workspace_member_can_manage(target_workspace uuid, target_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
```

**Logic:** `case workspace_member_role(target_workspace)` → owner may manage admin/manager/member; admin may manage manager/member; else false.

**Indirect soft-delete workspace check:** `workspace_member_role` joins `workspaces` and requires `wm.deleted_at is null` **and** `w.deleted_at is null`. If the workspace is soft-deleted (or the actor’s membership is), role is NULL → `can_manage` is false.

**EXECUTE:** `authenticated`, `service_role`.

### 2.2 Overload B — uuid, uuid (subject of prior concern)

```text
public.workspace_member_can_manage(p_workspace_id uuid, p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'   -- inconsistent with siblings
```

**Logic:** `EXISTS` over actor + target `workspace_members` rows:

- `actor.user_id = auth.uid()`
- `actor.deleted_at IS NULL`, `target.deleted_at IS NULL`
- Role pairs: owner→admin/manager/member; admin→manager/member
- **Does not** join `workspaces` / check `w.deleted_at`

**EXECUTE (baseline grants):**

```sql
revoke all … from public, anon, authenticated, service_role;
grant execute … to service_role;   -- NOT authenticated
```

### 2.3 Usage inventory

| Location | Which overload | Path type | Soft-delete WS impact |
| --- | --- | --- | --- |
| `team_members_insert` WITH CHECK | **(uuid, text)** via `can_manage(workspace_id, role)` | Direct RLS | Blocked when WS deleted (`workspace_member_role` → null) |
| `team_members_select` USING (soft-deleted others branch) | **(uuid, text)** | Direct RLS | Same |
| `team_members_update` USING / WITH CHECK | **(uuid, text)** | Direct RLS | Same |
| Archive `migrations_archive/20260928200000_team_members_rls.sql` | (uuid, text) | Historical only | Not production path |
| `src/features/workspaces/workspaceRoles.ts` | App mirror of **role** rules | Application-only UI | Not DB auth |
| **(uuid, uuid) overload** | Definition + grant to `service_role` only | **No RLS / RPC / trigger reference in repo** | No authenticated exploit path found |

**Conclusion:** Missing `workspaces.deleted_at` on the **(uuid, uuid)** overload is **not a confirmed vulnerability**. It is **defense-in-depth / consistency** hardening (and `search_path = 'public'` cleanup) if ever granted more widely or called from future DEFINER code. Reachable team RLS uses **(uuid, text)**, which already inherits workspace soft-delete exclusion via `workspace_member_role`.

---

## 3. `soft_delete_workspace` — transaction analysis (corrected)

### Definitions

| Version | File | Owner guard |
| --- | --- | --- |
| Original | `20260929000000_production_baseline.sql` | `if not (select workspace_member_role(...) = 'owner')` — NULL-unsafe |
| Hardened (authoritative in repo) | `20260929000050_soft_delete_workspace_owner_check.sql` | `EXISTS (… role=owner AND wm.deleted_at is null AND w.deleted_at is null)` |

No later migration in-repo replaces the hardened function again (spot-checked).

### Hardened body (behavior)

1. NULL-safe owner `EXISTS` check → else `42501`.  
2. `UPDATE workspaces SET deleted_at = now() WHERE id = … AND deleted_at is null`.  
3. `UPDATE workspace_members SET deleted_at = now() WHERE workspace_id = … AND deleted_at is null`.  

### Transaction safety findings

| Question | Answer | Evidence |
| --- | --- | --- |
| One function invocation? | Yes | Single `plpgsql` body |
| `EXCEPTION` handlers? | **No** | No `EXCEPTION` clause in either definition |
| Errors swallowed? | **No** | Failures propagate |
| Independent commits / dblink / external side effects? | **None in body** | Only two UPDATEs + membership SELECT in guard |
| Successful return with WS deleted but members active? | **Not under normal PG semantics** | Uncaught error aborts the **entire** surrounding transaction; neither UPDATE remains committed |
| Concurrent membership inserts during delete? | Possible race at app level; not a multi-commit split inside the function | New members after commit would be a **separate** transaction (ops concern, not partial commit of this function) |
| Owner guard NULL-safe (hardened)? | **Yes** | `EXISTS` never NULL |

**Correction of prior HIGH finding:**  
Describing “two sequential UPDATEs” as a partial-commit window was **incorrect**. Under PostgreSQL, both statements run in the caller’s transaction (typically the single RPC transaction). **NO REPRODUCIBLE PARTIAL-COMMIT PATH FOUND** in repository evidence.

**Remaining related risk (not partial commit):** If some **other** writer sets only `workspaces.deleted_at` (service role / ad-hoc SQL) while leaving members active, unpatched `crm_permitted_workspaces` still grants CRM access — that is the **CONFIRMED** helper defect (F1), not a soft_delete atomicity bug.

---

## 4. CRM patch validation (`20261101010000_…`)

### Original (`crm_ro_v1.PRODUCTION.sql`)

| Property | Value |
| --- | --- |
| Signature | `crm_permitted_workspaces(p_permission text default null)` |
| Returns | `setof uuid` |
| Language / volatility | `sql` / `stable` |
| Security | `security definer` |
| search_path | `''` |
| Member filter | `m.deleted_at is null` |
| Workspace filter | **Absent** |
| Permission logic | null → all active memberships; else owner **or** (admin without `member_roles`) **or** `role_permissions` match |
| Grants | revoke public/anon; grant `authenticated`, `service_role` |

### Patch behavior

| Check | Result |
| --- | --- |
| Same signature / return / default / sql stable definer / empty search_path | **Yes** |
| Same permission / role / `member_roles` / `role_permissions` logic | **Yes** |
| Only intentional change | `JOIN public.workspaces w` + `w.deleted_at is null` |
| Touches tables/policies? | **No** |
| Accurate description | **Function replacement** (CREATE OR REPLACE), not “additive DDL” on schema objects; “additive” only vs rewriting all CRM policies |
| Prerequisites | Aborts if function missing or `workspaces.deleted_at` column missing (`raise exception` inside `BEGIN` → rolls back) |
| Idempotent re-run | **Yes** — replace with same body; verify SELECT is read-only |
| `crm_has_permission` / RLS | Call the function by name → pick up new body automatically |
| VERIFY query | `position('w.deleted_at is null' in pg_get_functiondef(...))` — matches literal body; case-sensitive. Conceptually stronger: `position(lower(...) in lower(pg_get_functiondef(...)))` or regex. **No file edit performed.** |

**Required changes to the patch before MAIN:** **None** for correctness of the authorization fix. Optional later polish (case-insensitive verify) is non-blocking.

**Compatibility:** Safe relative to all CRM policies that only reference `crm_permitted_workspaces(...)` / `crm_has_permission`.

---

## 5. Wider authorization helpers (soft-delete focus)

| Helper | Member `deleted_at` | Workspace `deleted_at` | search_path | Notes |
| --- | --- | --- | --- | --- |
| `is_workspace_member` | Yes | Yes | `''` | Primary baseline RLS |
| `workspace_member_role` | Yes | Yes | `''` | Feeds (uuid,text) can_manage |
| `workspace_member_is_owner/admin` | Yes | Yes | `''` | |
| `workspace_member_can_manage(uuid,text)` | Via role helper | Via role helper | `''` | Used in RLS |
| `workspace_member_can_manage(uuid,uuid)` | Yes | **No** | `'public'` | Unused by authenticated RLS |
| `workspace_member_can_bootstrap` | n/a | Yes | `''` | |
| `workspace_member_profiles` / `find_user` | Yes | Yes | `''` | Team RPCs |
| `crm_permitted_workspaces` (unpatched) | Yes | **No** | `''` | **CONFIRMED gap** |
| `crm_permitted_workspaces` (2.1a) | Yes | Yes | `''` | Intended fix |
| Issue/return / warehouse RPCs (manual) | Via `is_workspace_member` (+ often `w.deleted_at`) | Varies by script | typically `''` | Prefer baseline helper |

No additional confirmed soft-delete bypass helpers found beyond unpatched `crm_permitted_workspaces`.

---

## 6. Final severity classification

| # | Finding | Classification |
| --- | --- | --- |
| 1 | `crm_permitted_workspaces` missing workspace deletion check | **CONFIRMED — must fix** |
| 2 | `workspace_member_can_manage(uuid, uuid)` | **DEFENSE-IN-DEPTH** (not exploitable via authenticated RLS in repo) |
| 3 | `soft_delete_workspace` atomicity / partial commit | **NOT CONFIRMED** |
| 4 | Logo Storage policy coverage | **DEFENSE-IN-DEPTH** if `20260929000400` applied; apply state **UNVERIFIED** |
| 5 | Order attachment Storage | **UNVERIFIED** |
| 6 | Payments RLS | **UNVERIFIED** |
| 7 | MAIN apply state of crm_ro_v1 / 2.1a / soft_delete hardening | **UNVERIFIED** |
| 8 | `FORCE ROW LEVEL SECURITY` on MAIN | **UNVERIFIED** (absent in repo) |

---

## 7. Read-only MAIN preflight SQL (do not run in this task)

Strictly SELECT / catalog reads. No DDL/DML/GRANT.

```sql
-- A) crm_permitted_workspaces existence + soft-delete filter (textual indicator only)
select
  to_regprocedure('public.crm_permitted_workspaces(text)') is not null as fn_exists,
  case
    when to_regprocedure('public.crm_permitted_workspaces(text)') is null then null
    else pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure)
  end as fn_def,
  case
    when to_regprocedure('public.crm_permitted_workspaces(text)') is null then false
    else
      position(
        lower('w.deleted_at is null')
        in lower(pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure))
      ) > 0
      or position(
        lower('workspaces.deleted_at is null')
        in lower(pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure))
      ) > 0
  end as filters_deleted_workspaces;
-- NOTE: filters_deleted_workspaces is only a textual indicator. TRUE does not independently
-- prove the condition is correctly applied in the authorization query — always inspect fn_def.

-- B) workspace_member_can_manage overloads
select p.oid::regprocedure as sig,
       p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'workspace_member_can_manage'
order by 1;

-- C) soft_delete_workspace
select
  to_regprocedure('public.soft_delete_workspace(uuid)') is not null as exists,
  case when to_regprocedure('public.soft_delete_workspace(uuid)') is null then null
       else pg_get_functiondef('public.soft_delete_workspace(uuid)'::regprocedure)
  end as def;

-- D) EXECUTE grants (examples)
select grantee, privilege_type, routine_name
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'crm_permitted_workspaces',
    'soft_delete_workspace',
    'workspace_member_can_manage',
    'is_workspace_member'
  )
order by routine_name, grantee;

-- E) RLS enabled / forced (ordinary + partitioned tables)
select c.relname,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'workspaces', 'workspace_members', 'clients', 'orders', 'payments',
    'warehouses', 'warehouse_stock', 'leads', 'estimates', 'finance_accounts'
  )
order by 1;

-- F) Policies of interest
select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
  and (
    tablename = 'payments'
    or tablename = 'objects'
    or policyname ilike 'crm_%'
  )
order by schemaname, tablename, policyname;

-- G) Inconsistent data: soft-deleted workspace with active memberships
select w.id as workspace_id,
       count(wm.workspace_id) filter (where wm.deleted_at is null) as active_members
from public.workspaces w
left join public.workspace_members wm on wm.workspace_id = w.id
where w.deleted_at is not null
group by w.id
having count(wm.workspace_id) filter (where wm.deleted_at is null) > 0
order by 1;
```

---

## 8. Proposed remediation order (when explicitly authorized)

1. Run **§7 preflight** on MAIN (read-only).  
2. If `crm_permitted_workspaces` exists and `filters_deleted_workspaces = false` → apply **only**  
   `supabase/manual/20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql`.  
3. Re-run verify SELECT from the patch / preflight A.  
4. If query G returns rows → **data cleanup plan** (separate authorization; not this patch).  
5. Optional later (non-blocking): align `(uuid,uuid) can_manage` search_path + `w.deleted_at`; inventory payments/storage FORCE RLS.

**Do not** expand this into warehouse/payment work under P0.1.

---

## 9. Remaining MAIN verification requirements

- crm_ro_v1 present?  
- 2.1a already applied?  
- Hardened `soft_delete_workspace` vs baseline NULL-guard version?  
- Query G empty?  
- Payments / storage policy inventory?  
- `relforcerowsecurity` for sensitive tables?

---

## 10. Architecture reference (unchanged facts)

Baseline helpers `is_workspace_member` / role / owner / admin **do** check both soft-delete columns. Soft-delete RPC soft-deletes workspace then all members. Owner self-removal while WS active blocked by `protect_workspace_owner`. App lists filter both `deleted_at` columns (`apiWorkspaces.ts`) — UX only, not the security boundary.

---

## 11. Source files inspected (this pass)

- `supabase/migrations/20260929000000_production_baseline.sql` (helpers, RLS, grants)  
- `supabase/migrations/20260929000050_soft_delete_workspace_owner_check.sql`  
- `supabase/migrations/20260929000100_workspace_member_read.sql`  
- `supabase/migrations/20260929000300_team_member_rpcs.sql`  
- `supabase/migrations/20260929000400_workspace_logo_storage_policies.sql`  
- `supabase/manual/crm_ro_v1.PRODUCTION.sql`  
- `supabase/manual/20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql`  
- `supabase/migrations_archive/20260928200000_team_members_rls.sql`  
- `src/features/workspaces/workspaceRoles.ts`  
- Prior content of this audit document  

---

## 12. Actions not performed

- No application source code changed (except this documentation file as required).  
- No SQL executed.  
- No migrations created or applied.  
- No remote database accessed (MAIN or TEST).  
- MAIN / TEST not modified.  
- No environment, Vercel, deploy, commit, or push.  
- Prepared CRM patch file **not** edited.
