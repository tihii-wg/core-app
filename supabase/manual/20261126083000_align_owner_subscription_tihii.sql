-- =============================================================================
-- One-time: give ALL workspaces of owner tihii-wg (f7133b93-3d6c-4cc0-9544-250daf4f36c6) the subscription
-- of «Sans» (trial until 2026-12-22). «Тест мебель» and «тест телефоны» were created before the trial
-- trigger existed and got 'active' with no end date, so they show no trial banner and never expire.
-- Touches only this owner's workspaces. Apply 20261125223000_subscription_per_owner first (keeps them in
-- sync afterwards). Safe to re-run.
-- =============================================================================

update public.workspaces w
set subscription_status     = s.subscription_status,
    subscription_started_at = s.subscription_started_at,
    subscription_expires_at = s.subscription_expires_at,
    subscription_updated_at = now()
from public.workspaces s
where s.id = 'cdbf8d72-28d7-4b94-8b76-738108d4bed1'
  and s.owner_id = 'f7133b93-3d6c-4cc0-9544-250daf4f36c6'
  and w.owner_id = s.owner_id
  and w.id <> s.id
  and w.deleted_at is null;

-- Check (all rows must show the same status / end date):
select name, subscription_status, subscription_expires_at
from public.workspaces
where owner_id = 'f7133b93-3d6c-4cc0-9544-250daf4f36c6' and deleted_at is null
order by created_at;
