-- Signed-out visitors can read the active industries shown by the signup form.
--
-- Depends only on 20260929000000_production_baseline.sql (public.industries with RLS enabled, SELECT
-- granted to authenticated only, and the policy "Authenticated users can view active industries").
--
-- Without a table grant, anon is rejected before RLS runs ("permission denied for table
-- industries"). Additive: the anon policy mirrors the authenticated one, which stays unchanged.
-- anon gets SELECT only; INSERT, UPDATE and DELETE stay ungranted for anon and authenticated, and
-- RLS stays enabled. No other table is affected.

create policy "Anonymous users can view active industries"
  on public.industries
  as permissive
  for select
  to anon
  using ((is_active = true));

grant select on table public.industries to anon;
