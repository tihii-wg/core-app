# Core App — Edge Functions

## Workspace backups

| Function | Purpose |
| --- | --- |
| `workspace-backup` | Build ZIP + upload to Google Drive / GitHub; scheduled (cron token) or manual (owner JWT). |
| `backup-google-oauth` | Google OAuth start + callback for Drive credentials. |
| `backup-github-connect` | Validate private repo + store fine-grained token. |

`verify_jwt = false` in `supabase/config.toml` — each function authenticates itself.

### Secrets (Project → Edge Functions → Secrets)

| Name | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | auto | |
| `SUPABASE_ANON_KEY` | auto | Used for user JWT clients |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | **Never expose to the browser** |
| `BACKUP_CRON_TOKEN` | yes | Same value as Vault secret `backup_cron_token` (scheduler) |
| `BACKUP_OAUTH_STATE_SECRET` | yes | Long random string for signing Google OAuth `state` |
| `GOOGLE_CLIENT_ID` | for Drive | Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | for Drive | |
| `APP_URL` | yes | App origin, e.g. `https://app.example.com` (CORS + redirects) |
| `BACKUP_MAX_FILES_MB` | no | Default `150` — skip remaining storage files beyond this |

### Scheduler

After deploying `workspace-backup`, create Vault secrets and apply  
`supabase/manual/20261107140100_workspace_backups_scheduler.PRODUCTION.sql`.

### Google OAuth redirect URI

Add to the Google Cloud OAuth client:

`https://<project-ref>.supabase.co/functions/v1/backup-google-oauth/callback`
