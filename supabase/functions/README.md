# Core App — Edge Functions

## Workspace backups

| Function | Purpose |
| --- | --- |
| `workspace-backup` | Build ZIP + upload to Google Drive / GitHub; scheduled (cron token) or manual (owner JWT). |
| `backup-google-oauth` | Google OAuth start + callback for Drive credentials. |
| `backup-github-connect` | Validate private repo + store fine-grained token. |

## Order photo storage (Drive + NAS)

| Function | Purpose |
| --- | --- |
| `google-drive-photos-oauth` | Owner OAuth start / callback / disconnect for order-photo Drive credentials (Vault). |
| `nas-storage` | Owner NAS WebDAV/S3 test / save / disconnect (Vault + `workspace_nas_storage`). |
| `order-attachment-remote` | Upload / content / delete remote attachments (Drive or NAS); trash order folder after order delete. |
| `order-attachment-drive` | Alias of `order-attachment-remote` (backward compatible). Prefer `order-attachment-remote`. |

All of the above use `verify_jwt = false` in `supabase/config.toml` and validate the bearer token themselves.

### Deploy (MAIN `pundggjzzaqzbvykbxvo`)

```bash
supabase functions deploy google-drive-photos-oauth --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy nas-storage --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
supabase functions deploy order-attachment-remote --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
# Optional alias:
supabase functions deploy order-attachment-drive --project-ref pundggjzzaqzbvykbxvo --no-verify-jwt
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
| `GOOGLE_CLIENT_ID` | for Drive | Google Cloud OAuth client (backups + order photos) |
| `GOOGLE_CLIENT_SECRET` | for Drive | |
| `APP_URL` | yes | App origin, e.g. `https://app.example.com` (CORS + redirects) |
| `BACKUP_MAX_FILES_MB` | no | Default `150` — skip remaining storage files beyond this |

SQL (applied by owner, not by the agent):

1. `supabase/manual/20261109090000_order_photos_google_drive.PRODUCTION.sql`
2. `supabase/manual/20261109100000_order_photos_nas.PRODUCTION.sql`

### Google OAuth redirect URIs

Add both to the Google Cloud OAuth client:

```
{SUPABASE_URL}/functions/v1/backup-google-oauth/callback
{SUPABASE_URL}/functions/v1/google-drive-photos-oauth/callback
```

Example for MAIN:

`https://pundggjzzaqzbvykbxvo.supabase.co/functions/v1/google-drive-photos-oauth/callback`

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
