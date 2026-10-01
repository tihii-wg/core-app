-- Core App: read-only schema and security snapshot of a Supabase project.
--
-- Run it in Dashboard -> SQL Editor. It is one SELECT over system catalogs: no DDL, no DML,
-- and it never reads rows of application tables, auth.users, storage.objects or vault.
-- Result: one row per section (section, item_count, items). Export the grid with
-- "Copy as JSON" (or Download CSV) and save it as supabase/snapshot/<project>_snapshot.json.
--
-- The same query is later run on the test project so both snapshots can be diffed.
-- JWT-shaped strings and sb_secret_ keys are redacted from the output; function bodies,
-- policies and webhook triggers still need a human review before the file is committed.

-- Empty search_path for this transaction only, so captured definitions come out schema-qualified.
select pg_catalog.set_config('search_path', '', true);

with
rels as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl,
         c.relrowsecurity, c.relforcerowsecurity, c.reloptions
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where (
      (n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S'))
      or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
    )
    and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
),
funcs as (
  select p.oid, p.proname, p.prokind, p.prosecdef, p.provolatile, p.proconfig, p.proowner, p.proacl, l.lanname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
),
migration_rows as (
  select case when pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    pg_catalog.query_to_xml(
      'select (to_jsonb(m) - ''statements'')::text as entry from supabase_migrations.schema_migrations m order by m.version',
      false, false, '')
  end as x
),
cron_rows as (
  select case when pg_catalog.to_regclass('cron.job') is not null then
    pg_catalog.query_to_xml('select jobname, schedule, active from cron.job order by jobname', false, false, '')
  end as x
),
sections as (
  select 1 as ord, 'meta' as section, 1::bigint as item_count,
    jsonb_build_object(
      'snapshot_format', 1,
      'server_version', current_setting('server_version'),
      'database', current_database(),
      'captured_at', now(),
      'captured_by', current_user
    ) as items

  union all
  select 2, 'extensions', count(*),
    coalesce(jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion, 'schema', n.nspname) order by e.extname), '[]')
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace

  union all
  select 3, 'schemas', count(*),
    coalesce(jsonb_agg(jsonb_build_object('name', n.nspname, 'owner', pg_catalog.pg_get_userbyid(n.nspowner), 'acl', n.nspacl::text[]) order by n.nspname), '[]')
  from pg_catalog.pg_namespace n
  where n.nspname in ('public', 'storage', 'auth', 'extensions')

  -- Schemas that are neither Postgres- nor Supabase-managed: app objects living outside public.
  union all
  select 4, 'other_schemas', count(*),
    coalesce(jsonb_agg(n.nspname order by n.nspname), '[]')
  from pg_catalog.pg_namespace n
  where n.nspname not like 'pg\_%'
    and n.nspname not in (
      'public', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', '_realtime',
      'graphql', 'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'supabase_functions',
      'supabase_migrations', 'cron', 'pgbouncer', '_analytics', 'pgtle', 'tiger', 'tiger_data', 'topology'
    )

  union all
  select 5, 'roles', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'name', r.rolname,
      'bypass_rls', r.rolbypassrls,
      'can_login', r.rolcanlogin,
      'inherit', r.rolinherit,
      'config', r.rolconfig,
      'member_of', (select jsonb_agg(pg_catalog.pg_get_userbyid(m.roleid) order by 1) from pg_catalog.pg_auth_members m where m.member = r.oid)
    ) order by r.rolname), '[]')
  from pg_catalog.pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres', 'supabase_auth_admin', 'supabase_storage_admin')

  union all
  select 6, 'types', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'name', t.typname,
      'kind', t.typtype::text,
      'enum_labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid = t.oid),
      'domain_base', case when t.typtype = 'd' then pg_catalog.format_type(t.typbasetype, t.typtypmod) end,
      'domain_not_null', case when t.typtype = 'd' then t.typnotnull end,
      'domain_default', t.typdefault,
      'domain_checks', (select jsonb_agg(pg_catalog.pg_get_constraintdef(c.oid)) from pg_catalog.pg_constraint c where c.contypid = t.oid),
      'composite_attributes', case when t.typtype = 'c' then (
        select jsonb_agg(jsonb_build_object('name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod)) order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
      ) end
    ) order by t.typname), '[]')
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and (t.typtype in ('e', 'd') or (t.typtype = 'c' and exists (select 1 from pg_catalog.pg_class c where c.oid = t.typrelid and c.relkind = 'c')))
    and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
    )

  union all
  select 7, 'relations', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'schema', r.nspname,
      'name', r.relname,
      'kind', r.relkind::text,
      'owner', pg_catalog.pg_get_userbyid(r.relowner),
      'rls_enabled', r.relrowsecurity,
      'rls_forced', r.relforcerowsecurity,
      'options', r.reloptions,
      'comment', pg_catalog.obj_description(r.oid, 'pg_class')
    ) order by r.nspname, r.relname), '[]')
  from rels r

  union all
  select 8, 'columns', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'table', r.relname,
      'position', a.attnum,
      'name', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull,
      'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
      'identity', nullif(a.attidentity::text, ''),
      'generated', nullif(a.attgenerated::text, ''),
      'collation', case when a.attcollation <> t.typcollation then co.collname end,
      'comment', pg_catalog.col_description(r.oid, a.attnum)
    ) order by r.relname, a.attnum), '[]')
  from rels r
  join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  join pg_catalog.pg_type t on t.oid = a.atttypid
  left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  left join pg_catalog.pg_collation co on co.oid = a.attcollation
  where r.nspname = 'public' and r.relkind in ('r', 'p', 'v', 'm', 'f')

  union all
  select 9, 'constraints', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'table', r.relname,
      'name', c.conname,
      'type', c.contype::text,
      'definition', pg_catalog.pg_get_constraintdef(c.oid, true),
      'deferrable', c.condeferrable,
      'deferred', c.condeferred,
      'validated', c.convalidated
    ) order by r.relname, c.conname), '[]')
  from rels r
  join pg_catalog.pg_constraint c on c.conrelid = r.oid
  where r.nspname = 'public'

  union all
  select 10, 'indexes', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'table', r.relname,
      'name', i.relname,
      'definition', pg_catalog.pg_get_indexdef(x.indexrelid),
      'backs_constraint', con.conname,
      'valid', x.indisvalid
    ) order by r.relname, i.relname), '[]')
  from rels r
  join pg_catalog.pg_index x on x.indrelid = r.oid
  join pg_catalog.pg_class i on i.oid = x.indexrelid
  left join pg_catalog.pg_constraint con on con.conindid = x.indexrelid and con.conrelid = r.oid
  where r.nspname = 'public'

  union all
  select 11, 'sequences', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'name', r.relname,
      'type', pg_catalog.format_type(s.seqtypid, null),
      'start', s.seqstart,
      'increment', s.seqincrement,
      'owned_by', (
        select tc.relname || '.' || ta.attname
        from pg_catalog.pg_depend d
        join pg_catalog.pg_class tc on tc.oid = d.refobjid
        join pg_catalog.pg_attribute ta on ta.attrelid = d.refobjid and ta.attnum = d.refobjsubid
        where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = r.oid and d.deptype in ('a', 'i')
        limit 1
      )
    ) order by r.relname), '[]')
  from rels r
  join pg_catalog.pg_sequence s on s.seqrelid = r.oid
  where r.nspname = 'public'

  union all
  select 12, 'views', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'name', r.relname,
      'kind', r.relkind::text,
      'options', r.reloptions,
      'definition', pg_catalog.pg_get_viewdef(r.oid, true)
    ) order by r.relname), '[]')
  from rels r
  where r.nspname = 'public' and r.relkind in ('v', 'm')

  union all
  select 13, 'functions', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'name', f.proname,
      'identity_args', pg_catalog.pg_get_function_identity_arguments(f.oid),
      'returns', pg_catalog.pg_get_function_result(f.oid),
      'kind', f.prokind::text,
      'language', f.lanname,
      'security_definer', f.prosecdef,
      'volatility', f.provolatile::text,
      'config', f.proconfig,
      'owner', pg_catalog.pg_get_userbyid(f.proowner),
      'definition', pg_catalog.pg_get_functiondef(f.oid)
    ) order by f.proname, pg_catalog.pg_get_function_identity_arguments(f.oid)), '[]')
  from funcs f

  -- App triggers on public tables, auth.users (e.g. new-user hooks) and storage tables.
  -- Webhook triggers (supabase_functions.http_request) carry request headers in their
  -- arguments, so their arguments are replaced.
  union all
  select 14, 'triggers', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'name', t.tgname,
      'enabled', t.tgenabled::text,
      'function', fn.nspname || '.' || fp.proname,
      'definition', case
        when fn.nspname = 'supabase_functions'
          then regexp_replace(pg_catalog.pg_get_triggerdef(t.oid, true), 'EXECUTE (FUNCTION|PROCEDURE) .*$', 'EXECUTE FUNCTION ' || fn.nspname || '.' || fp.proname || '(<arguments redacted>)')
        else pg_catalog.pg_get_triggerdef(t.oid, true)
      end
    ) order by n.nspname, c.relname, t.tgname), '[]')
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc fp on fp.oid = t.tgfoid
  join pg_catalog.pg_namespace fn on fn.oid = fp.pronamespace
  where not t.tgisinternal
    and (
      n.nspname = 'public'
      or (n.nspname = 'auth' and c.relname = 'users')
      or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
    )

  union all
  select 15, 'policies', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'schema', p.schemaname,
      'table', p.tablename,
      'name', p.policyname,
      'permissive', p.permissive,
      'roles', p.roles,
      'command', p.cmd,
      'using', p.qual,
      'with_check', p.with_check
    ) order by p.schemaname, p.tablename, p.policyname), '[]')
  from pg_catalog.pg_policies p
  where p.schemaname in ('public', 'storage')

  union all
  select 16, 'table_grants', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'schema', r.nspname,
      'table', r.relname,
      'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable,
      'grantor', pg_catalog.pg_get_userbyid(g.grantor)
    ) order by r.nspname, r.relname, 3, g.privilege_type), '[]')
  from rels r
  cross join lateral pg_catalog.aclexplode(coalesce(r.relacl, pg_catalog.acldefault(case when r.relkind = 'S' then 's' else 'r' end::"char", r.relowner))) g

  union all
  select 17, 'column_grants', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'table', r.relname,
      'column', a.attname,
      'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable
    ) order by r.relname, a.attname, 3, g.privilege_type), '[]')
  from rels r
  join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  cross join lateral pg_catalog.aclexplode(a.attacl) g
  where r.nspname = 'public'

  union all
  select 18, 'function_grants', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'function', f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')',
      'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable
    ) order by 1), '[]')
  from funcs f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f'::"char", f.proowner))) g

  union all
  select 19, 'default_privileges', count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'owner_role', pg_catalog.pg_get_userbyid(d.defaclrole),
      'schema', n.nspname,
      'object_type', d.defaclobjtype::text,
      'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type
    ) order by 1), '[]')
  from pg_catalog.pg_default_acl d
  left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) g
  where n.nspname is null or n.nspname = 'public'

  -- Bucket configuration only; storage.objects rows (files) are never read.
  union all
  select 20, 'storage_buckets', count(*),
    coalesce(jsonb_agg(to_jsonb(b) - 'owner' - 'owner_id' order by b.id), '[]')
  from storage.buckets b

  union all
  select 21, 'publications', count(*),
    coalesce(jsonb_agg(jsonb_build_object('publication', p.pubname, 'schema', p.schemaname, 'table', p.tablename) order by 1), '[]')
  from pg_catalog.pg_publication_tables p
  where p.schemaname = 'public'

  union all
  select 22, 'event_triggers', count(*),
    coalesce(jsonb_agg(jsonb_build_object('name', e.evtname, 'event', e.evtevent, 'function', e.evtfoid::regproc::text, 'enabled', e.evtenabled::text) order by e.evtname), '[]')
  from pg_catalog.pg_event_trigger e

  -- Which migrations the Supabase CLI recorded as applied (names and versions only).
  union all
  select 23, 'migration_history',
    coalesce(array_length(pg_catalog.xpath('//row', m.x), 1), 0),
    coalesce(to_jsonb(m.x::text), 'null')
  from migration_rows m

  -- pg_cron jobs: names and schedules only; job commands are left out (they can embed secrets).
  union all
  select 24, 'cron_jobs',
    coalesce(array_length(pg_catalog.xpath('//row', c.x), 1), 0),
    coalesce(to_jsonb(c.x::text), 'null')
  from cron_rows c
)
select
  s.section,
  s.item_count,
  regexp_replace(
    regexp_replace(s.items::text, 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '<redacted-jwt>', 'g'),
    'sb_secret_[A-Za-z0-9_-]+', '<redacted-secret-key>', 'g'
  )::jsonb as items
from sections s
order by s.ord;
