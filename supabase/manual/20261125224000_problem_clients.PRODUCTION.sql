-- =============================================================================
-- Problem clients: a flag on the client card; the name is shown in red with a mark everywhere.
-- Script: 20261125224000_problem_clients.PRODUCTION.sql — idempotent.
-- =============================================================================

alter table public.clients add column if not exists is_problem boolean not null default false;

-- The app reads only the flagged clients of a workspace (small list) in one request.
create index if not exists clients_problem_idx
  on public.clients (workspace_id)
  where is_problem and deleted_at is null;

-- Check: select id, name from public.clients where is_problem;
