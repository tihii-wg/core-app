# Archived migrations — do not apply

These six files predate the production baseline and are kept byte-for-byte for history only.
None of them matches production as written, and several would weaken or conflict with it
(DELETE on `workspace_members`, a weaker `is_workspace_member`, member-wide workspace updates,
a duplicate `inventory_markup_percent` column).

The active schema is defined by `supabase/migrations/`, starting with
`20260929000000_production_baseline.sql`, which was reconstructed from the production schema
snapshot and does not depend on anything in this folder.
