-- =============================================================================
-- MANUAL SQL — order-attachments Storage RLS (review only)
--
-- DO NOT auto-apply. Review in full before pasting into the Supabase SQL Editor.
-- This file has NOT been executed against any remote database by the authoring
-- process.
--
-- -----------------------------------------------------------------------------
-- What this script does
-- -----------------------------------------------------------------------------
-- Repairs storage.objects RLS for the private bucket order-attachments so paths
--   {workspace_id}/{order_id}/{uuid}-{sanitized-name}
-- (src/features/orders/orderAttachments.ts → buildOrderAttachmentStoragePath)
-- authorize only when:
--   bucket_id = 'order-attachments'
--   split_part(objects.name,'/',1)::uuid = public.orders.workspace_id
--   split_part(objects.name,'/',2)::uuid = public.orders.id
--   public.is_workspace_member(o.workspace_id)
--
-- Outer path column is objects.name (table storage.objects). Inside
-- EXISTS (SELECT … FROM public.orders o …), unqualified "name" binds to
-- orders.name. Project baseline Storage policies use objects.name the same way
-- (supabase/migrations/20260929000000_production_baseline.sql).
--
-- public.is_workspace_member(uuid) is required and not redefined
-- (SECURITY DEFINER; active membership + active workspace — baseline).
--
-- -----------------------------------------------------------------------------
-- Safety strategy (fail closed — no regex "semantic equivalence")
-- -----------------------------------------------------------------------------
-- Catalog text cannot prove two policy expressions are equivalent. This script:
--   1) Inventories storage.objects policies (NOTICE).
--   2) Aborts before any DROP on restrictive policies, unscoped policies,
--      unexpected names, mixed/unclear bucket predicates, or managed names whose
--      definitions are neither a structural "intended" re-run nor the confirmed
--      broken legacy marker foldername(o.name) under bucket_id = 'order-attachments'.
--   3) Auto-drops ONLY the four managed policy names, and only after that
--      structural classification succeeds for each existing managed row.
--   4) Never auto-drops unexpected policy names (including broken policies under
--      other names). Those require manual DROP, then re-run.
--   5) Creates the four managed policies, then structurally verifies them.
--   6) Leaves workspace-logo policies untouched when they match the known logo
--      name allowlist and are clearly scoped to bucket_id = 'workspace' without OR.
--
-- Structural checks reject OR / bucket_id <> / IN / ANY (mixed logic). They do
-- NOT prove the absence of every possible exotic predicate. Post-apply
-- verification is structural for the same reason — see section "Verification
-- limits" at the end of the header.
--
-- -----------------------------------------------------------------------------
-- Transaction honesty
-- -----------------------------------------------------------------------------
-- Body is wrapped in BEGIN … COMMIT. On PostgreSQL, policy DDL participates in
-- the transaction: a raised exception after DROP rolls back and restores drops
-- *if this entire script runs as one transaction*.
--
-- This script does NOT guarantee recovery if a SQL client splits statements and
-- autocommits each one. Keep BEGIN/COMMIT intact and run as a single batch.
--
-- Recovery if a non-transactional client left a partial state:
--   Inspect storage.objects policies for order-attachments / managed names,
--   manually DROP the managed four if needed, resolve any unexpected policies,
--   then re-run this entire file as one transaction.
--
-- Manual review when the script aborts:
--   The exception text names the policy. In the Supabase SQL Editor, inspect
--   that policy on storage.objects. If it is an obsolete order-attachments
--   rule, DROP it explicitly after review, then re-run this script. Do not DROP
--   workspace logo policies.
--
-- -----------------------------------------------------------------------------
-- Verification limits (read before treating output as “proven safe”)
-- -----------------------------------------------------------------------------
-- Final checks confirm required roles/commands, bucket literal, objects.name
-- path segments ↔ o.id / o.workspace_id, membership on o.workspace_id, UPDATE
-- USING+WITH CHECK, private bucket, and that no other policy text still
-- references 'order-attachments'. They cannot fully prove semantic identity of
-- arbitrary SQL. Human review of the CREATE POLICY bodies below remains
-- required before execution.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Read-only preflight + classification. First DROP is only after this block
--    decides the managed drop list (or aborts with no destructive changes).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  managed text[] := array[
    'Workspace members can view order attachments',
    'Workspace members can upload order attachments',
    'Workspace members can update order attachments',
    'Workspace members can delete order attachments'
  ];
  logo_names text[] := array[
    'Workspace members can view workspace logos',
    'Workspace members can upload workspace logos',
    'Workspace members can update workspace logos',
    'Workspace members can delete workspace logos',
    'Workspace admins can upload workspace logos',
    'Workspace admins can update workspace logos',
    'Workspace admins can delete workspace logos'
  ];
  drop_names text[] := array[]::text[];
  body text;
  defn text;
  pname text;
  leftover text;
  restrictive text;
  is_managed boolean;
  is_logo boolean;
  has_bucket boolean;
  looks_workspace boolean;
  looks_order_att boolean;
  mixed_bucket_logic boolean;
  broken_legacy boolean;
  intended boolean;
  path_ws text := 'split_part\s*\(\s*objects\.name\s*,\s*''/''\s*,\s*1\s*\)::uuid';
  path_ord text := 'split_part\s*\(\s*objects\.name\s*,\s*''/''\s*,\s*2\s*\)::uuid';
  expr text;
  cmd_ok boolean;
begin
  if not exists (select 1 from storage.buckets where id = 'order-attachments') then
    raise exception 'Preflight: bucket order-attachments does not exist';
  end if;

  if exists (
    select 1 from storage.buckets
    where id = 'order-attachments' and coalesce(public, false)
  ) then
    raise exception
      'Preflight: bucket order-attachments is public; refusing (must stay private)';
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: public.is_workspace_member(uuid) is missing';
  end if;

  -- Any restrictive policy on storage.objects can affect this bucket in ways
  -- catalog regex cannot safely dismiss (including workspace OR … forms).
  -- Match project logo migration: abort on every restrictive policy.
  select string_agg(policyname, ', ' order by policyname) into restrictive
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and permissive = 'RESTRICTIVE';
  if restrictive is not null then
    raise exception
      'Abort before DROP: restrictive storage.objects policy/policies require manual review (cannot prove irrelevance to order-attachments): %. Inspect each policy; do not re-run until restrictive policies are understood or removed by an operator.',
      restrictive;
  end if;

  -- Walk every storage.objects policy (not only those mentioning the bucket).
  for r in
    select policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
    order by policyname, cmd
  loop
    defn := format(
      'name=%s cmd=%s permissive=%s roles=%s qual=%s with_check=%s',
      r.policyname, r.cmd, r.permissive, r.roles,
      coalesce(r.qual, ''), coalesce(r.with_check, '')
    );
    raise notice 'storage.objects policy inventory: %', defn;

    body := coalesce(r.qual, '') || E'\n' || coalesce(r.with_check, '');
    is_managed := r.policyname = any (managed);
    is_logo := r.policyname = any (logo_names);
    has_bucket := body ~ 'bucket_id';
    looks_workspace := body ~ '''workspace''';
    looks_order_att := body ~ '''order-attachments''';
    mixed_bucket_logic :=
      body ~* '\mor\m'
      or body ~* 'bucket_id\s*<>'
      or body ~* 'bucket_id\s+in\s*\('
      or body ~* 'bucket_id\s*=\s*any'
      or body ~* 'not\s*\(\s*bucket_id'
      or (looks_workspace and looks_order_att);

    if not has_bucket then
      raise exception
        'Abort before DROP: policy % has no bucket_id predicate — may apply to all buckets including order-attachments. Manual review required. %',
        r.policyname, defn;
    end if;

    if mixed_bucket_logic then
      raise exception
        'Abort before DROP: policy % has mixed/unclear bucket logic (OR / <> / IN / ANY / NOT / both buckets). Manual review required. %',
        r.policyname, defn;
    end if;

    -- Known logo policies: leave untouched when clearly workspace-scoped.
    if is_logo then
      if not looks_workspace or looks_order_att
         or body !~ 'bucket_id\s*=\s*''workspace''' then
        raise exception
          'Abort before DROP: logo-named policy % is not a clear workspace-only definition. Manual review required. %',
          r.policyname, defn;
      end if;
      continue;
    end if;

    -- Non-logo, non-managed: must not touch order-attachments or be ambiguous.
    if not is_managed then
      if looks_order_att then
        raise exception
          'Abort before DROP: unexpected policy % references order-attachments. Auto-drop is refused for non-managed names. Manually inspect and DROP only if obsolete, then re-run. %',
          r.policyname, defn;
      end if;
      if looks_workspace and body ~ 'bucket_id\s*=\s*''workspace''' then
        -- Unexpected name but appears workspace-only without OR (checked above).
        -- Still refuse silent ignore of unexpected names.
        raise exception
          'Abort before DROP: unexpected storage.objects policy % appears workspace-scoped but is not in the logo name allowlist. Manual review required (preserve if legitimate; do not let this script drop it). %',
          r.policyname, defn;
      end if;
      raise exception
        'Abort before DROP: unexpected storage.objects policy % cannot be classified as logo allowlist or managed order-attachments. Manual review required. %',
        r.policyname, defn;
    end if;

    -- Managed name (looked up by name even if definition omits the bucket literal).
    broken_legacy :=
      looks_order_att
      and body ~ 'bucket_id\s*=\s*''order-attachments'''
      and body ~* 'foldername\s*\(\s*o\.name\s*\)'
      and not looks_workspace
      and body !~* '\mor\m'
      and body !~* 'bucket_id\s*<>';

    -- Intended re-run shape: required relationships, objects.name, no OR/foldername.
    expr := case
      when r.cmd = 'SELECT' then coalesce(r.qual, '')
      when r.cmd = 'INSERT' then coalesce(r.with_check, '')
      when r.cmd = 'DELETE' then coalesce(r.qual, '')
      when r.cmd = 'UPDATE' then coalesce(r.qual, '') || E'\n' || coalesce(r.with_check, '')
      else ''
    end;

    cmd_ok :=
      (r.cmd = 'SELECT' and coalesce(r.qual, '') <> '' and coalesce(r.with_check, '') = '')
      or (r.cmd = 'INSERT' and coalesce(r.with_check, '') <> '' and coalesce(r.qual, '') = '')
      or (r.cmd = 'DELETE' and coalesce(r.qual, '') <> '' and coalesce(r.with_check, '') = '')
      or (
        r.cmd = 'UPDATE'
        and coalesce(r.qual, '') <> ''
        and coalesce(r.with_check, '') <> ''
      );

    intended :=
      cmd_ok
      and r.permissive = 'PERMISSIVE'
      and r.roles @> array['authenticated']::name[]
      and coalesce(array_length(r.roles, 1), 0) = 1
      and looks_order_att
      and body ~ 'bucket_id\s*=\s*''order-attachments'''
      and not looks_workspace
      and body !~* 'foldername'
      and body !~* '\mor\m'
      and body !~* 'split_part\s*\(\s*name\s*,'
      and body ~* 'objects\.name'
      and body ~* 'from\s+public\.orders\s+o'
      and body ~* ('o\.id\s*=\s*.*' || path_ord)
      and body ~* ('o\.workspace_id\s*=\s*.*' || path_ws)
      and body ~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)'
      and expr ~* ('o\.id\s*=\s*.*' || path_ord)
      and expr ~* ('o\.workspace_id\s*=\s*.*' || path_ws)
      and expr ~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)'
      and (
        r.cmd <> 'UPDATE'
        or (
          r.qual ~* ('o\.id\s*=\s*.*' || path_ord)
          and r.qual ~* ('o\.workspace_id\s*=\s*.*' || path_ws)
          and r.qual ~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)'
          and r.with_check ~* ('o\.id\s*=\s*.*' || path_ord)
          and r.with_check ~* ('o\.workspace_id\s*=\s*.*' || path_ws)
          and r.with_check ~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)'
        )
      );

    if intended then
      drop_names := array_append(drop_names, r.policyname);
      raise notice 'Managed policy queued for replace (intended re-run): %', r.policyname;
    elsif broken_legacy then
      drop_names := array_append(drop_names, r.policyname);
      raise notice 'Managed policy queued for replace (broken foldername(o.name) legacy): %', r.policyname;
    else
      raise exception
        'Abort before DROP: managed policy % exists but is neither a structural intended re-run (objects.name path→o.id/o.workspace_id + is_workspace_member(o.workspace_id), no OR/foldername) nor confirmed broken legacy (bucket_id = order-attachments + foldername(o.name), no OR). Manual review required. %',
        r.policyname, defn;
    end if;
  end loop;

  -- Managed names with no row yet are fine (first install / after manual cleanup).
  foreach pname in array drop_names
  loop
    execute format('drop policy if exists %I on storage.objects', pname);
  end loop;

  -- Nothing that references order-attachments may remain before CREATE.
  select string_agg(policyname || '/' || cmd, ', ' order by policyname, cmd)
    into leftover
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (
      coalesce(qual, '') ~ '''order-attachments'''
      or coalesce(with_check, '') ~ '''order-attachments'''
      or policyname = any (managed)
    );
  if leftover is not null then
    raise exception
      'Abort after classified drops: order-attachments / managed policies still present (refusing CREATE): %. Manual cleanup required.',
      leftover;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Create the four managed policies (objects.name outer qualification).
-- ---------------------------------------------------------------------------

create policy "Workspace members can view order attachments"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "Workspace members can upload order attachments"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "Workspace members can update order attachments"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  )
  with check (
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "Workspace members can delete order attachments"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and exists (
      select 1
      from public.orders o
      where o.id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 2)::uuid
          end
        )
        and o.workspace_id = (
          case
            when objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
              then split_part(objects.name, '/', 1)::uuid
          end
        )
        and public.is_workspace_member(o.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Structural post-checks (not full semantic proof — see header limits).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  found text;
  extra text;
  body text;
  missing text;
  path_ws text := 'split_part\s*\(\s*objects\.name\s*,\s*''/''\s*,\s*1\s*\)::uuid';
  path_ord text := 'split_part\s*\(\s*objects\.name\s*,\s*''/''\s*,\s*2\s*\)::uuid';
  expected text :=
    'Workspace members can delete order attachments:DELETE:PERMISSIVE, '
    || 'Workspace members can update order attachments:UPDATE:PERMISSIVE, '
    || 'Workspace members can upload order attachments:INSERT:PERMISSIVE, '
    || 'Workspace members can view order attachments:SELECT:PERMISSIVE';
begin
  select string_agg(policyname || ':' || cmd || ':' || permissive, ', ' order by policyname)
    into found
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in (
      'Workspace members can view order attachments',
      'Workspace members can upload order attachments',
      'Workspace members can update order attachments',
      'Workspace members can delete order attachments'
    );

  if found is distinct from expected then
    raise exception
      'Verification failed: managed policy set mismatch (got %). Transaction will roll back if running as one txn.',
      found;
  end if;

  -- No other policy may reference order-attachments after repair.
  select string_agg(policyname, ', ' order by policyname) into extra
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (
      coalesce(qual, '') ~ '''order-attachments'''
      or coalesce(with_check, '') ~ '''order-attachments'''
    )
    and policyname not in (
      'Workspace members can view order attachments',
      'Workspace members can upload order attachments',
      'Workspace members can update order attachments',
      'Workspace members can delete order attachments'
    );
  if extra is not null then
    raise exception
      'Verification failed: non-managed policies still reference order-attachments: %',
      extra;
  end if;

  for r in
    select policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'Workspace members can view order attachments',
        'Workspace members can upload order attachments',
        'Workspace members can update order attachments',
        'Workspace members can delete order attachments'
      )
  loop
    body := coalesce(r.qual, '') || E'\n' || coalesce(r.with_check, '');
    missing := null;

    if r.permissive is distinct from 'PERMISSIVE' then
      missing := coalesce(missing || ', ', '') || 'not PERMISSIVE';
    end if;
    if not (r.roles @> array['authenticated']::name[] and coalesce(array_length(r.roles, 1), 0) = 1) then
      missing := coalesce(missing || ', ', '') || 'roles not exactly {authenticated}';
    end if;
    if body !~ 'bucket_id\s*=\s*''order-attachments''' then
      missing := coalesce(missing || ', ', '') || 'missing bucket_id = order-attachments';
    end if;
    if body ~ '''workspace''' then
      missing := coalesce(missing || ', ', '') || 'references workspace';
    end if;
    if body ~* 'foldername' then
      missing := coalesce(missing || ', ', '') || 'foldername present';
    end if;
    if body ~* '\mor\m' then
      missing := coalesce(missing || ', ', '') || 'OR present (mixed logic)';
    end if;
    if body ~* 'split_part\s*\(\s*name\s*,' then
      missing := coalesce(missing || ', ', '') || 'unqualified split_part(name)';
    end if;
    if body !~* 'objects\.name' then
      missing := coalesce(missing || ', ', '') || 'missing objects.name';
    end if;
    if body !~* 'from\s+public\.orders\s+o' then
      missing := coalesce(missing || ', ', '') || 'missing public.orders o';
    end if;
    if body !~* ('o\.id\s*=\s*.*' || path_ord) then
      missing := coalesce(missing || ', ', '') || 'missing o.id = split_part(objects.name,/,2)';
    end if;
    if body !~* ('o\.workspace_id\s*=\s*.*' || path_ws) then
      missing := coalesce(missing || ', ', '') || 'missing o.workspace_id = split_part(objects.name,/,1)';
    end if;
    if body !~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)' then
      missing := coalesce(missing || ', ', '') || 'missing is_workspace_member(o.workspace_id)';
    end if;

    if r.cmd = 'SELECT' then
      if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
        missing := coalesce(missing || ', ', '') || 'SELECT must have USING only';
      end if;
    elsif r.cmd = 'INSERT' then
      if coalesce(r.with_check, '') = '' or coalesce(r.qual, '') <> '' then
        missing := coalesce(missing || ', ', '') || 'INSERT must have WITH CHECK only';
      end if;
    elsif r.cmd = 'UPDATE' then
      if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') = '' then
        missing := coalesce(missing || ', ', '') || 'UPDATE needs USING and WITH CHECK';
      elsif coalesce(r.qual, '') !~* ('o\.id\s*=\s*.*' || path_ord)
         or coalesce(r.qual, '') !~* ('o\.workspace_id\s*=\s*.*' || path_ws)
         or coalesce(r.qual, '') !~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)'
         or coalesce(r.with_check, '') !~* ('o\.id\s*=\s*.*' || path_ord)
         or coalesce(r.with_check, '') !~* ('o\.workspace_id\s*=\s*.*' || path_ws)
         or coalesce(r.with_check, '') !~* 'is_workspace_member\s*\(\s*o\.workspace_id\s*\)' then
        missing := coalesce(missing || ', ', '') || 'UPDATE USING/WITH CHECK path/membership incomplete';
      end if;
    elsif r.cmd = 'DELETE' then
      if coalesce(r.qual, '') = '' or coalesce(r.with_check, '') <> '' then
        missing := coalesce(missing || ', ', '') || 'DELETE must have USING only';
      end if;
    else
      missing := coalesce(missing || ', ', '') || 'unexpected cmd';
    end if;

    if missing is not null then
      raise exception
        'Verification failed for %: %. qual=%; with_check=%',
        r.policyname, missing, coalesce(r.qual, ''), coalesce(r.with_check, '');
    end if;
  end loop;

  if exists (
    select 1 from storage.buckets
    where id = 'order-attachments' and coalesce(public, false)
  ) then
    raise exception 'Verification failed: order-attachments bucket is public';
  end if;
end;
$$;

commit;
