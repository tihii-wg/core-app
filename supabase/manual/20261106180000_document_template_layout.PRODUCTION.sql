-- =============================================================================
-- Print document builder: layout JSON + default template per document type
-- Script: 20261106180000_document_template_layout.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Adds to public.document_templates:
--   layout      jsonb   NULL  — block layout built in the visual editor
--                               (when NULL the template prints from body_html as before)
--   is_default  boolean NOT NULL DEFAULT false — default template for its document_type
-- + partial unique index: at most one active default per (workspace_id, document_type).
-- document_type values used by the app: 'work_order' (заказ-наряд), 'act' (акт), 'invoice' (счёт);
-- existing values are left untouched.
--
-- Does NOT: change RLS (settings.print_templates), body_html, or existing rows' content.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.document_templates') is null then
    raise exception 'document_template_layout preflight: document_templates missing (apply crm_ro_v1 first)';
  end if;
end;
$preflight$;

alter table public.document_templates add column if not exists layout jsonb;
alter table public.document_templates add column if not exists is_default boolean not null default false;

do $chk$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'document_templates_layout_is_object'
                   and conrelid = 'public.document_templates'::regclass) then
    alter table public.document_templates
      add constraint document_templates_layout_is_object
      check (layout is null or jsonb_typeof(layout) = 'object');
  end if;
end;
$chk$;

create unique index if not exists document_templates_one_default_per_type
  on public.document_templates (workspace_id, document_type)
  where is_default and deleted_at is null;

comment on column public.document_templates.layout is
  'Visual builder layout: { version, page, blocks[] }. NULL = legacy body_html template.';
comment on column public.document_templates.is_default is
  'Default template for this document_type in the workspace (one per type).';

do $postflight$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.document_templates'::regclass
                 and attname = 'layout' and not attisdropped) then
    raise exception 'document_template_layout postflight: layout column missing';
  end if;
end;
$postflight$;

commit;
