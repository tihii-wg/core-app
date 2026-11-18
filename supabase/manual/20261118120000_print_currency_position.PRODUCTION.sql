-- =============================================================================
-- Currency position in printed documents (before / after the amount)
-- Script: 20261118120000_print_currency_position.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- =============================================================================
-- workspaces.print_currency_position: 'before' → "MDL 1 200,00" (current behaviour, default),
--                                     'after'  → "1 200,00 MDL".
-- Used by every print (order, act, invoice, canvas and classic templates).
-- Idempotent. Transactional. Existing workspaces keep 'before'.
-- =============================================================================

begin;

alter table public.workspaces
  add column if not exists print_currency_position text not null default 'before';

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'workspaces_print_currency_position_check'
       and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_print_currency_position_check
      check (print_currency_position in ('before', 'after'));
  end if;
end;
$chk$;

comment on column public.workspaces.print_currency_position is
  'Currency code placement in printed documents: before ("MDL 100,00") or after ("100,00 MDL").';

notify pgrst, 'reload schema';

commit;
