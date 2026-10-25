# Local PostgreSQL validation — `harden_payment_ledger.sql`

Disposable, **local-only** checks for the manual harden script.  
Does **not** touch Supabase, Production, or TEST. Does **not** run as part of `npm test` / `npm run build`.

## Prerequisites (macOS)

PostgreSQL client + server with `psql`, `initdb`/`pg_ctl` or a Homebrew service.

Fastest Homebrew path (Apple Silicon):

```bash
# Fix Homebrew ownership if brew complains about Cellar permissions:
#   sudo chown -R "$(whoami)" /opt/homebrew/Cellar /opt/homebrew/bin

brew install postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

brew services start postgresql@17
# or: pg_ctl -D /opt/homebrew/var/postgresql@17 start
```

Confirm:

```bash
which psql
psql --version
psql -h 127.0.0.1 -d postgres -c 'select version();'
```

Postgres.app is fine too — put its `bin` on `PATH` and use host `127.0.0.1`.

## Run

From the Core App repo root:

```bash
npm run test:harden-ledger-sql
```

Or:

```bash
./supabase/manual-sql/local-validate/run.sh
```

Optional env (all default to local loopback + disposable DB name):

| Variable | Default | Notes |
|----------|---------|--------|
| `PGHOST` | `127.0.0.1` | Only `127.0.0.1`, `localhost`, or `::1` allowed |
| `PGPORT` | `5432` | |
| `PGUSER` | current OS user | |
| `HARDEN_LOCAL_DB` | `core_app_harden_ledger_local` | Recreated every run |

The harness **refuses** to run if the host looks remote (`*.supabase.co`, etc.) or if `inet_server_addr()` is not loopback/unix-socket.

## What it covers

- Syntax / PL/pgSQL compile by applying the real harden script
- First apply + idempotent re-apply
- Catalog: function `SECURITY DEFINER`, empty `search_path`, COMMENT marker, trigger binding, CHECKs
- Invalid inserts (amount/kind/method/currency/workspace)
- Overpayment and refund limits
- Concurrent payments / concurrent refunds via two `psql` sessions
- Preflight failure rollback (nullable column → abort, no leftover function)

## What it does not claim

- Not a substitute for reviewing Production catalog grants/RLS
- Concurrency results are only meaningful when the harness actually runs against local Postgres and prints PASS for those cases
