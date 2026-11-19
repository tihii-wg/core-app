-- Cancel a client balance (advance) entry.
--
-- client_balance_entries are a ledger: clients have no UPDATE / DELETE on it (RLS). Cancelling an entry
-- adds a reversal row (−amount, document_type = 'balance_cancel', document_id = the cancelled entry) and
-- subtracts the amount from clients.balance — the advance that the client settlement (взаиморасчёт) uses.
-- History stays visible; an entry can be cancelled once; a reversal itself cannot be cancelled.
--
-- Who: members with permission contacts.edit (owner / admin by default), only while the workspace
-- subscription allows writes (workspace_write_allowed, when that function exists).
-- Idempotent. Does not change existing rows.

begin;

create index if not exists client_balance_entries_document_idx
  on public.client_balance_entries (workspace_id, document_type, document_id);

create or replace function public.crm_cancel_client_balance_entry(p_entry_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_entry public.client_balance_entries%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_reversal_id uuid;
  v_balance numeric;
begin
  if p_entry_id is null then
    raise exception 'balance_cancel:invalid_args' using errcode = '22023';
  end if;

  select * into v_entry from public.client_balance_entries where id = p_entry_id for update;
  if not found then
    raise exception 'balance_cancel:not_found' using errcode = 'P0002';
  end if;

  if not public.crm_has_permission(v_entry.workspace_id, 'contacts.edit') then
    raise exception 'balance_cancel:forbidden' using errcode = '42501';
  end if;
  if to_regprocedure('public.workspace_write_allowed(uuid)') is not null
     and not public.workspace_write_allowed(v_entry.workspace_id) then
    raise exception 'balance_cancel:read_only' using errcode = '42501';
  end if;

  if v_entry.document_type = 'balance_cancel' then
    raise exception 'balance_cancel:is_reversal' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.client_balance_entries r
    where r.workspace_id = v_entry.workspace_id
      and r.document_type = 'balance_cancel'
      and r.document_id = v_entry.id
  ) then
    raise exception 'balance_cancel:already_cancelled' using errcode = '23505';
  end if;

  insert into public.client_balance_entries
    (workspace_id, client_id, amount, currency_code, document_type, document_id, description, is_adjustment, created_by)
  values (
    v_entry.workspace_id,
    v_entry.client_id,
    -v_entry.amount,
    v_entry.currency_code,
    'balance_cancel',
    v_entry.id,
    left(
      'Отмена: ' || coalesce(nullif(trim(v_entry.description), ''), 'запись баланса')
        || coalesce(' — ' || v_reason, ''),
      500
    ),
    true,
    auth.uid()
  )
  returning id into v_reversal_id;

  update public.clients
     set balance = coalesce(balance, 0) - v_entry.amount
   where id = v_entry.client_id
     and workspace_id = v_entry.workspace_id
  returning balance into v_balance;

  return jsonb_build_object('reversal_id', v_reversal_id, 'client_id', v_entry.client_id, 'balance', v_balance);
end;
$$;

revoke all on function public.crm_cancel_client_balance_entry(uuid, text) from public, anon;
grant execute on function public.crm_cancel_client_balance_entry(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
