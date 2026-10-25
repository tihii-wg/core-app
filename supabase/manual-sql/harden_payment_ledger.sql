-- =============================================================================
-- MANUAL SQL — Harden public.payments financial integrity
--
-- DO NOT auto-apply. Review and paste into the Supabase SQL Editor when ready.
-- This file has NOT been executed against any remote database by the authoring
-- process. Safeguards become active only after you run this script.
--
-- Schema evidence (repo):
--   - public.payments columns used by src/services/apiPayments.ts (DDL not in
--     migrations; table was applied separately). Required columns are preflighted.
--   - public.orders / public.invoices: NO currency column
--     (supabase/migrations/20261004010000_invoices.sql, production_baseline orders)
--   - public.workspaces.currency text NOT NULL default 'MDL'
--     (no ISO-4217 CHECK on workspaces.currency in baseline)
--   - At most one invoice per order: invoices_order_id_key
--   - Append-only client access expected (no UPDATE/DELETE for anon/authenticated)
--     Repo has no payments GRANT/POLICY snapshot; preflight inspects live catalog.
--
-- Access-control policy of THIS script:
--   - Does NOT revoke table/column privileges on public.payments.
--   - Does NOT drop or alter RLS policies on public.payments.
--   - Append-only preflight uses effective privileges (has_table_privilege /
--     has_column_privilege), including grants inherited via role membership.
--   - UPDATE/DELETE/ALL RLS policies that target PUBLIC (OID 0, alone or with
--     other roles) or any role that anon/authenticated inherit are rejected.
--     A policy alone is not proof of effective write access (grants also needed),
--     but this script intentionally fail-closes on potentially unsafe policy
--     configurations when it cannot prove append-only safety (conservative
--     false positives possible, e.g. USING (false) still flagged).
--   - Fix requires explicit operator approval, e.g.:
--       revoke update, delete on table public.payments from anon, authenticated;
--       -- plus revoke any column-level UPDATE; drop unexpected UPDATE/DELETE policies
--   - After installing the managed trigger function, revokes EXECUTE on that
--     function from public/anon/authenticated (SECURITY DEFINER hardening only).
--
-- Function / trigger replace policy:
--   - Only manages public.payments_enforce_integrity() and trigger
--     payments_enforce_integrity_bi on public.payments.
--   - Ownership is the versioned COMMENT marker
--     'managed-object: core-app/payments_enforce_integrity@v1'
--     (written in the same transaction after CREATE OR REPLACE).
--   - Absent function → first-run create is allowed. Same-named function without
--     that verified marker → ABORT (do not adopt older/unknown bodies).
--   - Same-named trigger must be absent or the expected BEFORE INSERT ROW binding.
--   - Other triggers on public.payments are left untouched.
--
-- Lock order (global):
--   1) WORKSPACE row FOR SHARE (currency / soft-delete stability), then
--   2) ORDER row FOR UPDATE (when an order is involved), then
--   3) INVOICE row FOR UPDATE (when an invoice is involved)
--   FOR SHARE on workspace allows concurrent payments in the same workspace while
--   blocking concurrent UPDATE of workspaces.currency (RowExclusiveLock conflicts
--   with ShareLock). Currency updates in-app only UPDATE the workspace row and do
--   not lock orders/invoices, so WORKSPACE → ORDER → INVOICE does not invert a
--   known app lock order. Invoice-linked inserts still peek invoice.order_id
--   unlocked only to learn whether an order lock is required first.
--
-- Refund lock order:
--   WORKSPACE FOR SHARE, then FOR UPDATE the original payment row, then compute
--   refundable remaining. Refunds do not take order/invoice locks (payment inserts
--   do not lock payment rows), so they do not invert ORDER → INVOICE.
--
-- Currency policy (fail-closed; no conversion in schema):
--   - Normalize NEW.currency_code to trim + upper; require ^[A-Z]{3}$
--   - Workspace must exist, deleted_at IS NULL, and currency must be ^[A-Z]{3}$
--     (soft-deleted / missing / invalid workspace currency → reject)
--   - NEW.currency_code must equal that workspace currency
--   - Existing ledger rows affecting the same order/invoice economic set must
--     all share one currency equal to NEW (do not sum across currencies)
--   - Historical mixed-currency rows are NOT rewritten; new inserts against that
--     economic set are rejected with payments_validation:currency_mixed
--
-- Invoice remaining includes:
--   - rows with invoice_id = this invoice, and
--   - order-only rows (order_id = invoice.order_id AND invoice_id IS NULL)
--   Each row counted once; refunds subtract.
--
-- Rerun: idempotent when the function COMMENT is exactly
--   managed-object: core-app/payments_enforce_integrity@v1
-- Unmarked or foreign same-named functions abort (no silent adopt). Prior
-- unmarked installs of an older harden revision require explicit drop/COMMENT.
-- CHECK constraints: add when missing; if same name exists, require validated
-- CHECK with complete intended rule (abort on NOT VALID / divergent def).
-- Enum CHECKs: exact normalized allowlists only (no open-ended regex extractors).
-- amount/kind/payment_method/currency_code must already be NOT NULL (CHECK treats
-- NULL as passing). This script does not add NOT NULL or rewrite rows.
-- payments_currency_code_format can FAIL to add if existing rows are not
-- already three uppercase letters — preflight aborts before ALTER in that case.
--
-- Concurrency (READ COMMITTED), proven by lock graph — not by live stress tests:
--   * Workspace currency/soft-delete UPDATE vs payment: WORKSPACE FOR SHARE blocks
--     RowExclusiveLock UPDATEs until the insert commits.
--   * Two payments same order: both FOR UPDATE the order row → serialized.
--   * Payments on invoice linked to order: ORDER then INVOICE FOR UPDATE → serialized.
--   * Invoice-only when order_id appears after peek: 40001 retry (no ORDER after INVOICE).
--   * Concurrent refunds same original: FOR UPDATE original payment → serialized.
--   * Payment vs refund on same economic set: refund does not take ORDER/INVOICE;
--     overpay uses committed rows only — cannot both overspend vs two payments
--     (those serialize on ORDER/INVOICE). Unproven: exotic writers that lock ORDER
--     before WORKSPACE (none in-repo).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preflight: schema, currency rows, append-only access, managed function/trigger
-- ---------------------------------------------------------------------------
do $$
declare
  missing text := '';
  col text;
  required text[] := array[
    'id','workspace_id','order_id','invoice_id','related_payment_id','kind',
    'amount','currency_code','payment_method','paid_at','note','created_by','created_at'
  ];
  bad_currency_count bigint;
  bad_access text := '';
  fn_oid oid;
  fn_cfg text;
  fn_comment text;
  managed_marker text := 'managed-object: core-app/payments_enforce_integrity@v1';
  tr_oid oid;
  tr_type int2;
  tr_fn oid;
  tr_enabled char;
begin
  if to_regclass('public.payments') is null then
    raise exception
      'Preflight failed: public.payments is missing. Apply the payments table DDL before this harden script.';
  end if;

  if to_regclass('public.orders') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.workspaces') is null then
    raise exception 'Preflight failed: public.orders, public.invoices, or public.workspaces is missing.';
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight failed: public.is_workspace_member(uuid) is missing.';
  end if;

  foreach col in array required loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payments'
        and column_name = col
    ) then
      missing := missing || col || ', ';
    end if;
  end loop;

  if missing <> '' then
    raise exception 'Preflight failed: public.payments missing columns: %', rtrim(missing, ', ');
  end if;

  -- CHECK (expr) passes when expr is NULL. Without NOT NULL, amount>0 / enum /
  -- currency regex CHECKs would accept NULL columns. This script does not ADD
  -- NOT NULL or rewrite rows — abort if the catalog cannot establish non-null.
  foreach col in array array['amount', 'kind', 'payment_method', 'currency_code'] loop
    if not exists (
      select 1
      from pg_attribute a
      where a.attrelid = 'public.payments'::regclass
        and a.attname = col
        and a.attnum > 0
        and not a.attisdropped
        and a.attnotnull
    ) then
      raise exception
        'Preflight failed: public.payments.% is not NOT NULL. PostgreSQL CHECK constraints treat NULL as satisfying the check, so financial CHECKs would not reject NULL %. Add NOT NULL manually after clearing null rows (this script does not alter nullability or backfill), then re-run.',
        col, col;
    end if;
  end loop;

  -- Fail closed before adding format CHECK: do not rewrite historical rows.
  select count(*) into bad_currency_count
  from public.payments p
  where p.currency_code is null
     or upper(trim(p.currency_code)) !~ '^[A-Z]{3}$'
     or p.currency_code is distinct from upper(trim(p.currency_code));

  if bad_currency_count > 0 then
    raise exception
      'Preflight failed: % payments.currency_code value(s) are not already normalized [A-Z]{3}. Fix or normalize those rows manually before re-running; this script does not backfill.',
      bad_currency_count;
  end if;

  ------------------------------------------------------------------
  -- Append-only: anon / authenticated must not UPDATE or DELETE rows.
  -- Effective privileges (role inheritance + PUBLIC grants). Does not revoke.
  ------------------------------------------------------------------
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.payments', 'UPDATE') then
      bad_access := bad_access || 'anon has effective table UPDATE; ';
    end if;
    if has_table_privilege('anon', 'public.payments', 'DELETE') then
      bad_access := bad_access || 'anon has effective table DELETE; ';
    end if;
    -- Column UPDATE (covers column-only grants and inherited grants).
    -- has_column_privilege is also true when table UPDATE is granted; that is OK.
    if exists (
      select 1
      from pg_attribute a
      where a.attrelid = 'public.payments'::regclass
        and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('anon', 'public.payments', a.attname, 'UPDATE')
    ) then
      bad_access := bad_access || 'anon has effective column UPDATE on public.payments; ';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_table_privilege('authenticated', 'public.payments', 'UPDATE') then
      bad_access := bad_access || 'authenticated has effective table UPDATE; ';
    end if;
    if has_table_privilege('authenticated', 'public.payments', 'DELETE') then
      bad_access := bad_access || 'authenticated has effective table DELETE; ';
    end if;
    if exists (
      select 1
      from pg_attribute a
      where a.attrelid = 'public.payments'::regclass
        and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('authenticated', 'public.payments', a.attname, 'UPDATE')
    ) then
      bad_access := bad_access || 'authenticated has effective column UPDATE on public.payments; ';
    end if;
  end if;

  -- RLS: reject UPDATE/DELETE/ALL policies that could apply to client roles.
  -- polcmd: r=SELECT a=INSERT w=UPDATE d=DELETE *=ALL
  -- PUBLIC is OID 0 and may appear alongside other role OIDs (0 = ANY(polroles)).
  -- Also flag policies granted to roles that anon/authenticated inherit.
  -- Conservative: a matching policy is not proof of effective writes (table/column
  -- grants still required), but absence of a conclusive safety proof → abort.
  -- False positives: USING (false) / never-true expressions still flagged.
  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'payments'
      and p.polcmd in ('w', 'd', '*')
      and (
        0 = any (p.polroles)
        or exists (
          select 1
          from unnest(p.polroles) as r(oid)
          where r.oid <> 0
            and (
              (
                exists (select 1 from pg_roles where rolname = 'anon')
                and pg_has_role('anon', r.oid, 'MEMBER')
              )
              or (
                exists (select 1 from pg_roles where rolname = 'authenticated')
                and pg_has_role('authenticated', r.oid, 'MEMBER')
              )
            )
        )
      )
  ) then
    bad_access := bad_access
      || 'UPDATE/DELETE/ALL RLS policy targets PUBLIC or a role inherited by anon/authenticated (fail-closed; not proof of effective write by itself); ';
  end if;

  if bad_access <> '' then
    raise exception
      'Preflight failed (append-only): %This script does not revoke grants or drop policies. With explicit approval, revoke UPDATE/DELETE (table and column) from anon/authenticated and remove UPDATE/DELETE/ALL RLS policies on public.payments, then re-run.',
      bad_access;
  end if;

  ------------------------------------------------------------------
  -- Managed function must be absent or carry the verified COMMENT marker.
  -- Body substrings are NOT used as ownership proof.
  ------------------------------------------------------------------
  select p.oid,
         coalesce(array_to_string(p.proconfig, ','), ''),
         obj_description(p.oid, 'pg_proc')
    into fn_oid, fn_cfg, fn_comment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'payments_enforce_integrity'
    and pg_get_function_identity_arguments(p.oid) = '';

  if fn_oid is not null then
    if coalesce(fn_comment, '') is distinct from managed_marker then
      raise exception
        'Preflight failed: public.payments_enforce_integrity() exists without the verified managed-object COMMENT (%). Found: %. Aborting without replacing unrelated or unmarked logic. With explicit approval, drop the function (and its trigger) or set the marker COMMENT after review, then re-run.',
        managed_marker,
        coalesce(fn_comment, '<null>');
    end if;
    if not exists (
      select 1 from pg_proc p where p.oid = fn_oid
        and p.prorettype = 'trigger'::regtype
        and p.prosecdef
    ) then
      raise exception
        'Preflight failed: public.payments_enforce_integrity() has the managed marker but is not a SECURITY DEFINER trigger function. Aborting without replacing it.';
    end if;
    -- Empty search_path only (SET search_path TO '').
    if not exists (
      select 1
      from pg_proc p
      cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as u(cfg)
      where p.oid = fn_oid
        and (u.cfg = 'search_path=' or u.cfg = 'search_path=""')
    ) then
      raise exception
        'Preflight failed: public.payments_enforce_integrity() has the managed marker but lacks an empty search_path. Aborting without replacing it. proconfig=%',
        fn_cfg;
    end if;
  end if;

  ------------------------------------------------------------------
  -- Managed trigger must be absent or correctly bound BEFORE INSERT ROW.
  ------------------------------------------------------------------
  select t.oid, t.tgtype, t.tgfoid, t.tgenabled
    into tr_oid, tr_type, tr_fn, tr_enabled
  from pg_trigger t
  where t.tgrelid = 'public.payments'::regclass
    and t.tgname = 'payments_enforce_integrity_bi'
    and not t.tgisinternal;

  if tr_oid is not null then
    -- ROW=1 BEFORE=2 INSERT=4; reject DELETE=8 UPDATE=16 INSTEAD=64
    if (tr_type & 1) = 0
       or (tr_type & 2) = 0
       or (tr_type & 4) = 0
       or (tr_type & 8) <> 0
       or (tr_type & 16) <> 0
       or (tr_type & 64) <> 0
       or tr_enabled not in ('O', 'A')
       or tr_fn is distinct from to_regprocedure('public.payments_enforce_integrity()') then
      raise exception
        'Preflight failed: trigger payments_enforce_integrity_bi exists on public.payments but is not a BEFORE INSERT FOR EACH ROW trigger bound to public.payments_enforce_integrity(). Aborting without dropping it. Inspect: select pg_get_triggerdef(%);',
        tr_oid;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Additive CHECKs (exact normalized allowlist; require convalidated)
-- Same-named divergent or NOT VALID constraints abort — never drop/replace.
-- Fail-closed: no open-ended regex extraction (avoids $$…$$$ delimiter bugs and
-- self-reference false accepts). Mirrors paymentLedgerSqlGuards.ts allowlists.
-- ---------------------------------------------------------------------------
do $$
declare
  def text;
  def_norm text;
  con_oid oid;
  con_validated boolean;
  con_type "char";
  accepted boolean;
  methods text[] := array['cash', 'card', 'bank_transfer', 'other'];
  i int;
  j int;
  k int;
  l int;
  p1 text;
  p2 text;
  p3 text;
  p4 text;

  -- Normalize lowercase CHECK text: strip whitespace + common casts.
  -- (No dollar-quoted regexes in this block.)
begin
  -- ========== payments_amount_positive: amount > 0 ==========
  select c.oid, c.convalidated, c.contype, pg_get_constraintdef(c.oid)
    into con_oid, con_validated, con_type, def
  from pg_constraint c
  where c.conname = 'payments_amount_positive'
    and c.conrelid = 'public.payments'::regclass;

  if con_oid is null then
    alter table public.payments
      add constraint payments_amount_positive check (amount > 0);
  else
    if con_type is distinct from 'c' then
      raise exception
        'Constraint conflict: payments_amount_positive on public.payments is not a CHECK (contype=%). Aborting without dropping it.',
        con_type;
    end if;
    if not coalesce(con_validated, false) then
      raise exception
        'Constraint conflict: payments_amount_positive exists but is NOT VALID. Aborting without dropping it. Validate or replace manually with approval.';
    end if;
    def_norm := regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        lower(regexp_replace(def, '\s+', '', 'g')),
                        '::text\[\]', '', 'gi'),
                      '::text', '', 'gi'),
                    '::numeric', '', 'gi'),
                  '::bpchar|::charactervarying', '', 'gi');
    if def_norm not in (
      'check((amount>0))',
      'check((amount>(0)))',
      'check(amount>0)'
    ) then
      raise exception
        'Constraint conflict: payments_amount_positive exists with definition %, expected CHECK (amount > 0). Aborting without dropping it.',
        def;
    end if;
  end if;

  -- ========== payments_kind_check: kind ∈ {payment, refund} ==========
  select c.oid, c.convalidated, c.contype, pg_get_constraintdef(c.oid)
    into con_oid, con_validated, con_type, def
  from pg_constraint c
  where c.conname = 'payments_kind_check'
    and c.conrelid = 'public.payments'::regclass;

  if con_oid is null then
    alter table public.payments
      add constraint payments_kind_check
      check (kind = any (array['payment'::text, 'refund'::text]));
  else
    if con_type is distinct from 'c' then
      raise exception
        'Constraint conflict: payments_kind_check on public.payments is not a CHECK (contype=%). Aborting without dropping it.',
        con_type;
    end if;
    if not coalesce(con_validated, false) then
      raise exception
        'Constraint conflict: payments_kind_check exists but is NOT VALID. Aborting without dropping it.';
    end if;

    def_norm := regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        lower(regexp_replace(def, '\s+', '', 'g')),
                        '::text\[\]', '', 'gi'),
                      '::text', '', 'gi'),
                    '::numeric', '', 'gi'),
                  '::bpchar|::charactervarying', '', 'gi');

    -- Exact allowlist only (rejects self-refs, OR true, extra values, etc.).
    if def_norm not in (
      'check((kind=any(array[''payment'',''refund''])))',
      'check((kind=any(array[''refund'',''payment''])))',
      'check((kind=any(''{payment,refund}'')))',
      'check((kind=any(''{refund,payment}'')))',
      'check((kindin(''payment'',''refund'')))',
      'check((kindin(''refund'',''payment'')))'
    ) then
      raise exception
        'Constraint conflict: payments_kind_check exists with definition %, expected exact literal kind ∈ {payment, refund}. Aborting without dropping it.',
        def;
    end if;
  end if;

  -- ========== payments_payment_method_check ==========
  select c.oid, c.convalidated, c.contype, pg_get_constraintdef(c.oid)
    into con_oid, con_validated, con_type, def
  from pg_constraint c
  where c.conname = 'payments_payment_method_check'
    and c.conrelid = 'public.payments'::regclass;

  if con_oid is null then
    alter table public.payments
      add constraint payments_payment_method_check
      check (payment_method = any (array['cash'::text, 'card'::text, 'bank_transfer'::text, 'other'::text]));
  else
    if con_type is distinct from 'c' then
      raise exception
        'Constraint conflict: payments_payment_method_check on public.payments is not a CHECK (contype=%). Aborting without dropping it.',
        con_type;
    end if;
    if not coalesce(con_validated, false) then
      raise exception
        'Constraint conflict: payments_payment_method_check exists but is NOT VALID. Aborting without dropping it.';
    end if;

    def_norm := regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        lower(regexp_replace(def, '\s+', '', 'g')),
                        '::text\[\]', '', 'gi'),
                      '::text', '', 'gi'),
                    '::numeric', '', 'gi'),
                  '::bpchar|::charactervarying', '', 'gi');

    -- Exact allowlist over all permutations of the four literals (ARRAY / brace / IN).
    accepted := false;
    for i in 1..4 loop
      for j in 1..4 loop
        continue when j = i;
        for k in 1..4 loop
          continue when k = i or k = j;
          for l in 1..4 loop
            continue when l = i or l = j or l = k;
            p1 := methods[i];
            p2 := methods[j];
            p3 := methods[k];
            p4 := methods[l];
            if def_norm = format(
                 'check((payment_method=any(array[''%s'',''%s'',''%s'',''%s''])))',
                 p1, p2, p3, p4
               )
               or def_norm = format(
                 'check((payment_method=any(''{%s,%s,%s,%s}'')))',
                 p1, p2, p3, p4
               )
               or def_norm = format(
                 'check((payment_methodin(''%s'',''%s'',''%s'',''%s'')))',
                 p1, p2, p3, p4
               ) then
              accepted := true;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;

    if not accepted then
      raise exception
        'Constraint conflict: payments_payment_method_check exists with definition %, expected exact literal cash|card|bank_transfer|other. Aborting without dropping it.',
        def;
    end if;
  end if;

  -- ========== payments_currency_code_format: ~ ^[A-Z]{3}$ ==========
  select c.oid, c.convalidated, c.contype, pg_get_constraintdef(c.oid)
    into con_oid, con_validated, con_type, def
  from pg_constraint c
  where c.conname = 'payments_currency_code_format'
    and c.conrelid = 'public.payments'::regclass;

  if con_oid is null then
    alter table public.payments
      add constraint payments_currency_code_format
      check (currency_code ~ '^[A-Z]{3}$');
  else
    if con_type is distinct from 'c' then
      raise exception
        'Constraint conflict: payments_currency_code_format on public.payments is not a CHECK (contype=%). Aborting without dropping it.',
        con_type;
    end if;
    if not coalesce(con_validated, false) then
      raise exception
        'Constraint conflict: payments_currency_code_format exists but is NOT VALID. Aborting without dropping it.';
    end if;

    -- Case-preserving: regex must remain ^[A-Z]{3}$
    def_norm := regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(def, '\s+', '', 'g'),
                      '::text\[\]', '', 'gi'),
                    '::text', '', 'gi'),
                  '::bpchar|::charactervarying', '', 'gi');
    if def_norm not in (
      'CHECK((currency_code~''^[A-Z]{3}$''))',
      'CHECK(currency_code~''^[A-Z]{3}$'')',
      'check((currency_code~''^[A-Z]{3}$''))',
      'check(currency_code~''^[A-Z]{3}$'')'
    ) then
      raise exception
        'Constraint conflict: payments_currency_code_format exists with definition %, expected CHECK (currency_code ~ ''^[A-Z]{3}$''). Aborting without dropping it.',
        def;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger function (CREATE OR REPLACE only after managed-or-absent preflight)
-- ---------------------------------------------------------------------------
create or replace function public.payments_enforce_integrity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_peek_order_id uuid;
  v_peek_workspace uuid;
  v_order_id uuid;
  v_invoice_id uuid;
  v_locked_order_id uuid;
  v_order_workspace uuid;
  v_invoice_workspace uuid;
  v_invoice_order uuid;
  v_invoice_total numeric;
  v_order_total numeric;
  v_workspace_currency text;
  v_original public.payments%rowtype;
  v_refunded numeric;
  v_paid numeric;
  v_remaining numeric;
  v_currency_count integer;
  v_existing_currency text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  -- Normalize + format currency
  new.currency_code := upper(trim(coalesce(new.currency_code, '')));
  if new.currency_code !~ '^[A-Z]{3}$' then
    raise exception 'payments_validation:currency_format' using errcode = '23514';
  end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'payments_validation:amount_positive' using errcode = '23514';
  end if;

  if new.kind is null or new.kind not in ('payment', 'refund') then
    raise exception 'payments_validation:method_invalid' using errcode = '23514';
  end if;

  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'bank_transfer', 'other') then
    raise exception 'payments_validation:method_invalid' using errcode = '23514';
  end if;

  if new.workspace_id is null or not public.is_workspace_member(new.workspace_id) then
    raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
  end if;

  -- Fail closed: workspace must exist, not soft-deleted (deleted_at IS NULL),
  -- and currency must be a normalized three-letter code. Orders/invoices have
  -- no currency column; workspaces.currency is the sole billing currency.
  --
  -- FOR SHARE first (global lock order: WORKSPACE → ORDER → INVOICE). Blocks
  -- concurrent workspace currency UPDATEs for the life of this insert while
  -- still allowing concurrent payment ShareLocks on the same workspace.
  select upper(trim(coalesce(w.currency, ''))) into v_workspace_currency
  from public.workspaces w
  where w.id = new.workspace_id
    and w.deleted_at is null
  for share;

  if not found then
    raise exception 'payments_validation:workspace_currency_invalid' using errcode = '23514';
  end if;
  if v_workspace_currency !~ '^[A-Z]{3}$' then
    raise exception 'payments_validation:workspace_currency_invalid' using errcode = '23514';
  end if;
  if v_workspace_currency is distinct from new.currency_code then
    raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
  end if;

  if new.kind = 'payment' then
    new.related_payment_id := null;

    if new.order_id is null and new.invoice_id is null then
      raise exception 'payments_validation:link_required' using errcode = '23514';
    end if;

    v_order_id := new.order_id;
    v_invoice_id := new.invoice_id;
    v_locked_order_id := null;

    ------------------------------------------------------------------
    -- Lock acquisition (ORDER then INVOICE). Peek is not authoritative.
    -- Workspace ShareLock already held above.
    ------------------------------------------------------------------
    if v_invoice_id is not null and v_order_id is null then
      -- Peek only to discover whether an order must be locked first.
      select i.order_id, i.workspace_id
        into v_peek_order_id, v_peek_workspace
      from public.invoices i
      where i.id = v_invoice_id;

      if not found then
        raise exception 'payments_validation:invoice_not_found' using errcode = '23503';
      end if;
      if v_peek_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;
      v_order_id := v_peek_order_id;
    end if;

    if v_order_id is not null then
      select o.workspace_id, o.total_price
        into v_order_workspace, v_order_total
      from public.orders o
      where o.id = v_order_id
      for update;

      if not found then
        raise exception 'payments_validation:order_not_found' using errcode = '23503';
      end if;
      if v_order_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;
      v_locked_order_id := v_order_id;
      new.order_id := v_order_id;
    end if;

    -- Resolve invoice id for order-only inserts (still before locking invoice).
    if v_invoice_id is null and v_order_id is not null then
      select i.id into v_invoice_id
      from public.invoices i
      where i.workspace_id = new.workspace_id
        and i.order_id = v_order_id;
    end if;

    if v_invoice_id is not null then
      select i.workspace_id, i.order_id, i.total
        into v_invoice_workspace, v_invoice_order, v_invoice_total
      from public.invoices i
      where i.id = v_invoice_id
      for update;

      if not found then
        raise exception 'payments_validation:invoice_not_found' using errcode = '23503';
      end if;
      if v_invoice_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;

      -- Re-validate relationship after locks.
      --
      -- Invoice-only race: unlocked peek may have seen order_id IS NULL, so we
      -- did not take the order FOR UPDATE. If the locked invoice now has a
      -- non-null order_id, assigning it without locking that order would skip
      -- serialization against concurrent order payments. Taking the order lock
      -- here would invert the global ORDER → INVOICE order and risk deadlock.
      -- Fail closed with a retryable error so the client can re-submit (peek
      -- will then see the order and lock ORDER then INVOICE correctly).
      if v_invoice_order is not null and v_locked_order_id is null then
        raise exception 'payments_validation:invoice_order_changed_retry' using errcode = '40001';
      end if;
      if v_invoice_order is not null
         and v_locked_order_id is not null
         and v_locked_order_id is distinct from v_invoice_order then
        raise exception 'payments_validation:invoice_order_mismatch' using errcode = '23514';
      end if;
      if v_invoice_order is null and v_locked_order_id is not null then
        raise exception 'payments_validation:invoice_order_mismatch' using errcode = '23514';
      end if;
      if v_invoice_order is not null then
        new.order_id := v_invoice_order;
        v_order_id := v_invoice_order;
      end if;

      new.invoice_id := v_invoice_id;
    end if;

    ------------------------------------------------------------------
    -- Currency consistency on the economic set (no cross-currency sum)
    ------------------------------------------------------------------
    select
      count(distinct upper(trim(p.currency_code))),
      min(upper(trim(p.currency_code)))
    into v_currency_count, v_existing_currency
    from public.payments p
    where p.workspace_id = new.workspace_id
      and (
        (new.invoice_id is not null and p.invoice_id = new.invoice_id)
        or (new.order_id is not null and p.order_id = new.order_id)
        or (
          new.invoice_id is not null
          and new.order_id is not null
          and p.order_id = new.order_id
          and p.invoice_id is null
        )
        or (
          new.order_id is not null
          and exists (
            select 1 from public.invoices i
            where i.id = p.invoice_id
              and i.order_id = new.order_id
              and i.workspace_id = new.workspace_id
          )
        )
      );

    if coalesce(v_currency_count, 0) > 1 then
      -- Historical mixed currencies: leave rows untouched; block further inserts.
      raise exception 'payments_validation:currency_mixed' using errcode = '23514';
    end if;
    if coalesce(v_currency_count, 0) = 1
       and v_existing_currency is distinct from new.currency_code then
      raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
    end if;

    ------------------------------------------------------------------
    -- Overpayment: invoice economic net (invoice rows + order-only legacy)
    ------------------------------------------------------------------
    if new.invoice_id is not null then
      select coalesce(sum(
               case
                 when p.kind = 'payment' then p.amount
                 when p.kind = 'refund' then -p.amount
                 else 0
               end
             ), 0)
        into v_paid
      from public.payments p
      where p.workspace_id = new.workspace_id
        and (
          p.invoice_id = new.invoice_id
          or (
            new.order_id is not null
            and p.order_id = new.order_id
            and p.invoice_id is null
          )
        );
      -- Currency already enforced consistent above; do not filter by currency
      -- here (would reintroduce multi-currency bypass).

      select i.total into v_invoice_total
      from public.invoices i
      where i.id = new.invoice_id;

      v_remaining := greatest(coalesce(v_invoice_total, 0) - coalesce(v_paid, 0), 0);
      if new.amount > v_remaining + 0.005 then
        raise exception 'payments_validation:payment_exceeds_remaining' using errcode = '23514';
      end if;
    end if;

    ------------------------------------------------------------------
    -- Overpayment: order economic net (order + its invoice links)
    ------------------------------------------------------------------
    if new.order_id is not null then
      select coalesce(sum(
               case
                 when p.kind = 'payment' then p.amount
                 when p.kind = 'refund' then -p.amount
                 else 0
               end
             ), 0)
        into v_paid
      from public.payments p
      where p.workspace_id = new.workspace_id
        and (
          p.order_id = new.order_id
          or (
            new.invoice_id is not null
            and p.invoice_id = new.invoice_id
          )
          or exists (
            select 1
            from public.invoices i
            where i.id = p.invoice_id
              and i.order_id = new.order_id
              and i.workspace_id = new.workspace_id
          )
        );

      select o.total_price into v_order_total
      from public.orders o
      where o.id = new.order_id;

      v_remaining := greatest(coalesce(v_order_total, 0) - coalesce(v_paid, 0), 0);
      if new.amount > v_remaining + 0.005 then
        raise exception 'payments_validation:payment_exceeds_remaining' using errcode = '23514';
      end if;
    end if;

  elsif new.kind = 'refund' then
    if new.related_payment_id is null then
      raise exception 'payments_validation:refund_invalid_original' using errcode = '23514';
    end if;

    -- Serialize concurrent refunds: lock original BEFORE reading refund totals.
    select *
      into v_original
    from public.payments p
    where p.id = new.related_payment_id
    for update;

    if not found then
      raise exception 'payments_validation:refund_invalid_original' using errcode = '23503';
    end if;

    if v_original.workspace_id is distinct from new.workspace_id then
      raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
    end if;

    if v_original.kind is distinct from 'payment' then
      raise exception 'payments_validation:refund_against_refund' using errcode = '23514';
    end if;

    if upper(trim(v_original.currency_code)) is distinct from new.currency_code then
      raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
    end if;

    -- Retain original payment's order/invoice links (ignore client tampering).
    new.order_id := v_original.order_id;
    new.invoice_id := v_original.invoice_id;

    select coalesce(sum(p.amount), 0)
      into v_refunded
    from public.payments p
    where p.workspace_id = new.workspace_id
      and p.kind = 'refund'
      and p.related_payment_id = v_original.id;

    v_remaining := greatest(v_original.amount - coalesce(v_refunded, 0), 0);
    if new.amount > v_remaining + 0.005 then
      raise exception 'payments_validation:refund_exceeds_remaining' using errcode = '23514';
    end if;

  else
    raise exception 'payments_validation:method_invalid' using errcode = '23514';
  end if;

  return new;
end;
$function$;

-- Versioned managed-object marker (same transaction as CREATE OR REPLACE).
-- Preflight on later runs requires this exact COMMENT before allowing replace.
comment on function public.payments_enforce_integrity() is
  'managed-object: core-app/payments_enforce_integrity@v1';

-- SECURITY DEFINER: callers must not EXECUTE this function directly.
-- (Table UPDATE/DELETE privileges are NOT modified here — see append-only preflight.)
revoke all on function public.payments_enforce_integrity() from public;
revoke all on function public.payments_enforce_integrity() from anon;
revoke all on function public.payments_enforce_integrity() from authenticated;

-- Recreate only the managed trigger. Preflight already verified that any existing
-- payments_enforce_integrity_bi is the expected BEFORE INSERT ROW binding (or absent).
-- Other triggers on public.payments are not dropped or altered.
drop trigger if exists payments_enforce_integrity_bi on public.payments;

create trigger payments_enforce_integrity_bi
  before insert on public.payments
  for each row
  execute function public.payments_enforce_integrity();

-- Inspect other triggers (untouched):
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.payments'::regclass and not tgisinternal;

commit;

-- =============================================================================
-- After you execute (not active until then)
--
-- Lock order: WORKSPACE (FOR SHARE) → ORDER → INVOICE for payment inserts.
-- Invoice-only peeks order_id, then locks order (if any) before locking invoice,
-- then re-reads the invoice. If peek saw no order but the locked invoice now
-- has an order_id, the insert fails with invoice_order_changed_retry (retryable)
-- instead of locking the order after the invoice.
--
-- Workspace currency: ShareLock held for the insert txn prevents concurrent
-- UPDATE of that workspace row (app path: updateWorkspacePreferences). This does
-- not coordinate with hypothetical future writers that lock ORDER before
-- WORKSPACE — no such path exists in-repo today.
--
-- Mixed-currency history: not modified; new inserts on that economic set fail
-- with payments_validation:currency_mixed until manually reconciled outside
-- this script.
--
-- Managed marker ownership is an assertion via COMMENT, not a hash of the body.
-- Reruns with the matching marker replace the function body with this revision.
-- =============================================================================
