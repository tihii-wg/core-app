-- =============================================================================
-- Problem clients: a flag on the client card; the name is shown in red with a mark everywhere.
-- Script: 20261125224000_problem_clients.PRODUCTION.sql — idempotent.
-- =============================================================================

alter table public.clients add column if not exists is_problem boolean not null default false;

-- The app looks flags up only for the clients on the current page (by primary key, batched).

-- Check: select id, name from public.clients where is_problem;
