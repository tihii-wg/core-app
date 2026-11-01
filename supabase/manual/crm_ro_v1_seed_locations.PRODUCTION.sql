-- =====================================================================
-- Core App: локация по умолчанию для каждого рабочего пространства (seed).
--
-- Запускать ПОСЛЕ crm_ro_v1.PRODUCTION.sql (нужна public.locations).
-- Бэкап обязателен; сначала применить на TEST.
--
-- Что делает:
--   * для каждого неудалённого рабочего пространства (workspaces.deleted_at is null),
--     у которого нет НИ ОДНОЙ неудалённой локации, вставляет одну локацию:
--       name       = название рабочего пространства (если пустое — 'Main'),
--       is_default = true, is_active = true;
--   * отчёт: сколько локаций вставлено и сколько пространств всё ещё без локации.
--
-- Чего не делает:
--   * не трогает пространства, у которых уже есть локация (в том числе неактивная) —
--     настройки владельца не перезаписываются, is_default у существующих не меняется;
--   * не меняет и не удаляет существующие строки; не привязывает склады, заказы
--     и правила уведомлений к локации (location_id остаётся как есть);
--   * ничего не отправляет и не пишет в RO App.
--
-- Идемпотентно: повторный запуск ничего не вставит. Уникальный индекс
-- locations_one_default_idx (одна локация по умолчанию на пространство) защищает от гонок;
-- on conflict do nothing пропускает такую строку без ошибки.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.locations') is null then
    raise exception 'Нет public.locations: сначала примените crm_ro_v1.PRODUCTION.sql';
  end if;
end $$;

do $$
declare
  v_inserted integer;
begin
  insert into public.locations (workspace_id, name, is_default, is_active)
  select w.id, coalesce(nullif(btrim(w.name), ''), 'Main'), true, true
  from public.workspaces w
  where w.deleted_at is null
    and not exists (
      select 1 from public.locations l
      where l.workspace_id = w.id and l.deleted_at is null
    )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  raise notice 'locations inserted: %', v_inserted;
end $$;

-- VERIFY (read-only; runs after the insert, inside the same transaction): expected 0.
select count(*) as workspaces_still_without_location
from public.workspaces w
where w.deleted_at is null
  and not exists (select 1 from public.locations l where l.workspace_id = w.id and l.deleted_at is null);

commit;
