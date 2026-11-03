-- =============================================================================
-- Core App — READ-ONLY VERIFY for sync_order_materials secure replacement
-- Run AFTER APPLY on MAIN. No writes. Does not CALL the RPC.
-- =============================================================================

do $verify$
declare
  v_oid oid;
  v_owner name;
  v_sec text;
  v_path text;
  v_lang text;
  v_src text;
  v_ret text;
  v_problems text[] := array[]::text[];
  v_grantee name;
  v_privilege text;
  v_is_grantable boolean;
  v_auth_exec boolean := false;
  v_service_exec boolean := false;
  v_anon_exec boolean := false;
  v_public_exec boolean := false;
  v_unexpected_direct text[] := array[]::text[];
  v_unexpected_effective text[] := array[]::text[];
  v_allowed_direct name[] := array['authenticated', 'service_role'];
  v_allowed_effective name[] := array[
    'authenticated', 'service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin'
  ];
  v_idx_ok boolean := false;
  v_idx_name text;
  v_role record;
begin
  v_oid := to_regprocedure('public.sync_order_materials(uuid, jsonb)');
  if v_oid is null then
    raise exception 'VERIFY FAIL: public.sync_order_materials(uuid, jsonb) missing';
  end if;

  select pg_get_function_result(v_oid) into v_ret;
  if v_ret is distinct from 'SETOF order_materials'
     and v_ret is distinct from 'SETOF public.order_materials' then
    v_problems := array_append(v_problems, format('return type=%s (expected SETOF order_materials)', coalesce(v_ret, '<null>')));
  end if;

  select r.rolname,
         case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
         (
           select cfg
           from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
           where cfg like 'search_path=%'
           limit 1
         ),
         l.lanname,
         p.prosrc
    into v_owner, v_sec, v_path, v_lang, v_src
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  join pg_language l on l.oid = p.prolang
  where p.oid = v_oid;

  if v_sec is distinct from 'DEFINER' then
    v_problems := array_append(v_problems, format('security=%s (expected DEFINER)', v_sec));
  end if;

  if v_path is null
     or (
       v_path is distinct from 'search_path='
       and v_path is distinct from 'search_path=""'
       and v_path is distinct from 'search_path='''''
     ) then
    v_problems := array_append(v_problems, format('search_path=%s (expected empty)', coalesce(v_path, '<unset>')));
  end if;

  if v_lang is distinct from 'plpgsql' then
    v_problems := array_append(v_problems, format('language=%s (expected plpgsql)', v_lang));
  end if;

  if position('pg_temp' in lower(coalesce(v_src, ''))) > 0
     or position('create temporary' in lower(coalesce(v_src, ''))) > 0
     or position('create temp ' in lower(coalesce(v_src, ''))) > 0 then
    v_problems := array_append(v_problems, 'function body still references TEMP / pg_temp staging');
  end if;

  if position('for update' in lower(coalesce(v_src, ''))) = 0 then
    v_problems := array_append(v_problems, 'function body missing FOR UPDATE locking');
  end if;

  if position('order by om.inventory_item_id nulls last' in lower(coalesce(v_src, ''))) = 0
     and position('order by om.inventory_item_id nulls last, om.id' in lower(coalesce(v_src, ''))) = 0 then
    -- tolerate whitespace variants already lowercased
    if position('inventory_item_id nulls last' in lower(coalesce(v_src, ''))) = 0 then
      v_problems := array_append(v_problems, 'material lock order missing inventory_item_id NULLS LAST');
    end if;
  end if;

  if position('cannot change material name after issue or return activity' in lower(coalesce(v_src, ''))) = 0
     or position('cannot change material price after issue or return activity' in lower(coalesce(v_src, ''))) = 0
     or position('cannot change material supply source after issue or return activity' in lower(coalesce(v_src, ''))) = 0 then
    v_problems := array_append(v_problems, 'history-freeze guards missing from body');
  end if;

  if position('duplicate catalog inventory_item_id in materials payload' in lower(coalesce(v_src, ''))) = 0 then
    v_problems := array_append(v_problems, 'payload duplicate catalog rejection missing');
  end if;

  if position('invalid line_id' in lower(coalesce(v_src, ''))) = 0
     or position('invalid inventory_item_id' in lower(coalesce(v_src, ''))) = 0 then
    v_problems := array_append(v_problems, 'strict identifier validation messages missing');
  end if;

  -- Direct ACL via aclexplode (PUBLIC = grantee oid 0)
  for v_grantee, v_privilege, v_is_grantable in
    select
      case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end,
      acl.privilege_type,
      acl.is_grantable
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where p.oid = v_oid
      and acl.privilege_type = 'EXECUTE'
  loop
    if v_grantee = 'authenticated' then
      v_auth_exec := true;
    elsif v_grantee = 'service_role' then
      v_service_exec := true;
    elsif v_grantee = 'anon' then
      v_anon_exec := true;
    elsif v_grantee = 'PUBLIC' then
      v_public_exec := true;
    elsif v_grantee = v_owner then
      null;
    elsif not (v_grantee = any (v_allowed_direct)) then
      v_unexpected_direct := array_append(v_unexpected_direct, v_grantee);
    end if;
  end loop;

  -- Effective privileges (includes role-membership inheritance)
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    v_problems := array_append(v_problems, 'authenticated lacks effective EXECUTE');
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    v_problems := array_append(v_problems, 'service_role lacks effective EXECUTE');
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    v_problems := array_append(v_problems, 'anon has effective EXECUTE (forbidden)');
  end if;

  -- Flag non-superuser login/roles with unexpected effective EXECUTE
  for v_role in
    select r.rolname
    from pg_roles r
    where has_function_privilege(r.oid, v_oid, 'EXECUTE')
      and not r.rolsuper
      and r.rolname is distinct from v_owner
      and not (r.rolname = any (v_allowed_effective))
      and not (r.rolname = any (v_allowed_direct))
  loop
    v_unexpected_effective := array_append(v_unexpected_effective, v_role.rolname);
  end loop;

  if not v_auth_exec then
    v_problems := array_append(v_problems, 'authenticated missing direct EXECUTE grant');
  end if;
  if not v_service_exec then
    v_problems := array_append(v_problems, 'service_role missing direct EXECUTE grant');
  end if;
  if v_anon_exec then
    v_problems := array_append(v_problems, 'anon has direct EXECUTE (forbidden)');
  end if;
  if v_public_exec then
    v_problems := array_append(v_problems, 'PUBLIC has EXECUTE (forbidden)');
  end if;
  if cardinality(v_unexpected_direct) > 0 then
    v_problems := array_append(v_problems,
      format('unexpected direct EXECUTE grantees: %s', array_to_string(v_unexpected_direct, ', ')));
  end if;
  if cardinality(v_unexpected_effective) > 0 then
    v_problems := array_append(v_problems,
      format('unexpected effective EXECUTE via role membership: %s', array_to_string(v_unexpected_effective, ', ')));
  end if;

  -- Catalog uniqueness (same semantics as PREFLIGHT/APPLY)
  select true, c.relname into v_idx_ok, v_idx_name
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'order_materials'
    and i.indisunique
    and i.indisvalid
    and i.indisready
    and not i.indisexclusion
    and i.indnkeyatts = 2
    and i.indexprs is null
    and i.indkey[0] > 0
    and i.indkey[1] > 0
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[0]) = 'order_id'
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[1]) = 'inventory_item_id'
    and (
      i.indpred is null
      or regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '\s+', ' ', 'g')
         in ('inventory_item_id is not null', '(inventory_item_id is not null)')
    )
  limit 1;

  if not coalesce(v_idx_ok, false) then
    v_problems := array_append(v_problems, 'acceptable catalog uniqueness index missing');
  end if;

  if cardinality(v_problems) > 0 then
    raise exception 'VERIFY FAIL:%s', E'\n- ' || array_to_string(v_problems, E'\n- ');
  end if;

  raise notice 'VERIFY OK: sync_order_materials owner=%s index=%s ACL+definition checks passed', v_owner, v_idx_name;
end
$verify$;
