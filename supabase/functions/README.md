# Core App — Edge Functions

## Workspace backups

| Function | Purpose |
| --- | --- |
| `workspace-backup` | Build ZIP + upload to Google Drive / GitHub; scheduled (cron token) or manual (owner JWT). |
| `backup-google-oauth` | Google OAuth start + callback for Drive credentials. |
| `backup-github-connect` | Validate private repo + store fine-grained token. |
| `workspace-restore` | Restore a backup ZIP into a NEW workspace (owner of the source workspace only). Needs `20261116120000_workspace_restore.PRODUCTION.sql`. |

## Order photo storage (Drive + NAS)

| Function | Purpose |
| --- | --- |
| `google-drive-photos-oauth` | Owner OAuth start / callback / disconnect for order-photo Drive credentials (Vault). |
| `nas-storage` | Owner NAS WebDAV/S3 test / save / disconnect (Vault + `workspace_nas_storage`). |
| `order-attachment-remote` | Upload / content / delete remote attachments (Drive or NAS); trash order folder after order delete. |
| `order-attachment-drive` | Alias of `order-attachment-remote` (backward compatible). Prefer `order-attachment-remote`. |

## Shared Google Calendar

| Function | Purpose |
| --- | --- |
| `google-calendar-oauth` | Owner OAuth start / callback / disconnect; refresh token in Vault (`crm_gcal_*`); metadata in `workspace_google_calendar`. |
| `google-calendar` | Member JSON API: list/select calendars (owner), settings, CRUD events; JWT + `is_workspace_member`; tokens never leave the Edge Function. |
| `google-calendar-sync` | Cron / client poke: one-way order dates → Google events (`gcal_sync_queue`); auth via `x-gcal-cron-token` or member JWT. |

Scopes: `calendar.events`, `calendar.calendarlist.readonly`, `email`. Reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_URL`.

All of the above use `verify_jwt = false` in `supabase/config.toml` and validate the bearer token themselves.

### Deploy (MAIN `pundggjzzaqzbvykbxvo`)

```bash
supabase functions deploy google-drive-photos-oauth --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy nas-storage --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy order-attachment-remote --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
# Optional alias:
supabase functions deploy order-attachment-drive --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy google-calendar-oauth --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy google-calendar --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy google-calendar-sync --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
```

Shared modules under `supabase/functions/_shared` are bundled automatically.

### Secrets (Project → Edge Functions → Secrets)

| Name | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | auto | |
| `SUPABASE_ANON_KEY` | auto | Used for user JWT clients |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | **Never expose to the browser** |
| `BACKUP_CRON_TOKEN` | yes (backups) | Same value as Vault secret `backup_cron_token` (scheduler) |
| `OAUTH_STATE_SECRET` | yes (photos OAuth) | Prefer this for signing Google OAuth `state` |
| `BACKUP_OAUTH_STATE_SECRET` | yes (backups) | Fallback for photos OAuth if `OAUTH_STATE_SECRET` is unset |
| `GOOGLE_CLIENT_ID` | for Drive / Calendar | Google Cloud OAuth client (backups + order photos + calendar) |
| `GOOGLE_CLIENT_SECRET` | for Drive / Calendar | |
| `APP_URL` | yes | App origin, e.g. `https://app.example.com` (CORS + redirects) |
| `GCAL_CRON_TOKEN` | for calendar sync | Same value as Vault secret `gcal_sync_cron_token` |
| `BACKUP_MAX_FILES_MB` | no | Default `150` — skip remaining storage files beyond this |

SQL (applied by owner, not by the agent):

1. `supabase/manual/20261109090000_order_photos_google_drive.PRODUCTION.sql`
2. `supabase/manual/20261109100000_order_photos_nas.PRODUCTION.sql`
3. `supabase/manual/20261113100000_google_calendar.PRODUCTION.sql` (shared calendar — do not apply until authorized)
4. `supabase/manual/20261114090000_google_calendar_order_sync.PRODUCTION.sql` (visibility + order sync — create Vault secrets first; see script header)

### Google OAuth redirect URIs

Add these to the Google Cloud OAuth client:

```
{SUPABASE_URL}/functions/v1/backup-google-oauth/callback
{SUPABASE_URL}/functions/v1/google-drive-photos-oauth/callback
{SUPABASE_URL}/functions/v1/google-calendar-oauth/callback
```

Example for MAIN:

`https://pundggjzzaqzbvykbxvo.supabase.co/functions/v1/google-drive-photos-oauth/callback`

`https://pundggjzzaqzbvykbxvo.supabase.co/functions/v1/google-calendar-oauth/callback`

### Exposing a Synology NAS over HTTPS (order photos)

Edge Functions run on the public internet and **must** reach the NAS at a public `https://` URL. Private LAN IPs, `localhost`, QuickConnect, and plain `http://` are rejected (SSRF protection).

**Option A — DDNS + Let's Encrypt (WebDAV HTTPS, typical Synology port 5006)**

1. Enable DSM → Control Panel → External Access → DDNS (or your own domain).
2. Certificate → Let's Encrypt for that hostname.
3. Enable WebDAV Server package; turn on **HTTPS** (default Synology port **5006**).
4. Create a dedicated DSM user with access **only** to a folder such as `/CoreApp` (no admin).
5. In Core App Settings → Storage → NAS:
   - Protocol: WebDAV
   - Address: `https://your-ddns.example.com:5006` (or the WebDAV path your NAS expects, e.g. `https://host:5006/`)
   - Folder: `/CoreApp`
   - Username / password of that limited user
6. Use **Test connection**, then **Save**.

**Option B — Cloudflare Tunnel (no open ports)**

1. Install `cloudflared` on the NAS or a always-on host on the same LAN.
2. Create a Tunnel that routes `https://nas-photos.example.com` → `https://nas.local:5006` (WebDAV) or your S3-compatible endpoint.
3. Use the Cloudflare hostname as the NAS Address in Core App (still `https://` only).
4. QuickConnect URLs are **not** supported.

**S3-compatible object storage on the NAS** (MinIO / Synology Object Storage): use protocol S3 with endpoint `https://…`, bucket, region, and access/secret keys. The Edge Function signs requests with SigV4.

### Scheduler (backups)

After deploying `workspace-backup`, create Vault secrets and apply  
`supabase/manual/20261107140100_workspace_backups_scheduler.PRODUCTION.sql`.
