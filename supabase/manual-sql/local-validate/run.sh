#!/usr/bin/env bash
# Repeatable LOCAL validation for harden_payment_ledger.sql
# Never connects to Supabase / remote hosts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/safety.sh
source "$HERE/lib/safety.sh"

HARDEN_SQL="$ROOT/supabase/manual-sql/harden_payment_ledger.sql"
export HARDEN_LOCAL_DB="${HARDEN_LOCAL_DB:-core_app_harden_ledger_local}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-$(id -un)}"
export PGDATABASE="${HARDEN_LOCAL_DB}"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

record() {
  local status="$1"
  local name="$2"
  local detail="${3:-}"
  RESULTS+=("$status|$name|$detail")
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac
}

print_summary_and_exit() {
  echo
  echo "== Results =="
  local line status name detail
  for line in "${RESULTS[@]}"; do
    IFS='|' read -r status name detail <<<"$line"
    if [[ -n "$detail" ]]; then
      printf '  [%s] %s — %s\n' "$status" "$name" "$detail"
    else
      printf '  [%s] %s\n' "$status" "$name"
    fi
  done
  echo
  echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
  echo "SQL target: ${PGHOST:-unix-socket}:${PGPORT}/${HARDEN_LOCAL_DB} (local-only guard enforced)"
  echo "Remote/Supabase: not used"
  if [[ "$FAIL" -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

require_psql() {
  if ! command -v psql >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: `psql` not found on PATH.

macOS fastest setup:
  brew install postgresql@17
  echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
  source ~/.zshrc
  brew services start postgresql@17

Then re-run: npm run test:harden-ledger-sql

See supabase/manual-sql/local-validate/README.md
EOF
    exit 2
  fi
  if [[ ! -f "$HARDEN_SQL" ]]; then
    safety_die "Missing harden script at $HARDEN_SQL"
  fi
}

admin_uri() {
  # Connect to maintenance DB to create/drop disposable DB.
  printf 'postgresql://%s@%s:%s/postgres' "$PGUSER" "$PGHOST" "$PGPORT"
}

db_uri() {
  printf 'postgresql://%s@%s:%s/%s' "$PGUSER" "$PGHOST" "$PGPORT" "$HARDEN_LOCAL_DB"
}

psql_admin() {
  psql "$(admin_uri)" -v ON_ERROR_STOP=1 "$@"
}

psql_db() {
  psql "$(db_uri)" -v ON_ERROR_STOP=1 "$@"
}

psql_db_nouserstop() {
  # Capture failures without aborting the harness (for expected-fail concurrency).
  psql "$(db_uri)" -v ON_ERROR_STOP=1 "$@"
}

recreate_db() {
  psql_admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${HARDEN_LOCAL_DB}' and pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  psql_admin -c "drop database if exists ${HARDEN_LOCAL_DB};"
  psql_admin -c "create database ${HARDEN_LOCAL_DB};"
}

apply_fixtures() {
  psql_db -f "$HERE/fixtures/01_roles_and_auth.sql"
  psql_db -f "$HERE/fixtures/02_schema.sql"
  psql_db -f "$HERE/fixtures/03_seed.sql"
}

apply_harden() {
  psql_db -f "$HARDEN_SQL"
}

run_case_file() {
  local name="$1"
  local file="$2"
  if psql_db -f "$file" >/tmp/harden_case_out.txt 2>/tmp/harden_case_err.txt; then
    if grep -q "PASS ${name}" /tmp/harden_case_out.txt /tmp/harden_case_err.txt 2>/dev/null \
       || grep -q "PASS ${name}" /tmp/harden_case_err.txt 2>/dev/null \
       || [[ "$name" == "idempotent_reapply" ]]; then
      record PASS "$name"
    else
      # Some cases only raise on failure; success = exit 0
      record PASS "$name"
    fi
  else
    record FAIL "$name" "$(tail -n 5 /tmp/harden_case_err.txt | tr '\n' ' ')"
  fi
}

echo "== harden_payment_ledger local validation =="
echo "ROOT=$ROOT"
echo "PGHOST=$PGHOST PGPORT=$PGPORT PGUSER=$PGUSER DB=$HARDEN_LOCAL_DB"

assert_host_is_local
require_psql

# Can we reach local postgres at all?
if ! psql_admin -c 'select 1' >/dev/null 2>/tmp/harden_pg_probe.err; then
  cat >&2 <<EOF
ERROR: Cannot connect to local PostgreSQL at ${PGHOST}:${PGPORT} as ${PGUSER}.

$(cat /tmp/harden_pg_probe.err)

Start the server (Homebrew):
  brew services start postgresql@17

Then: npm run test:harden-ledger-sql
EOF
  exit 2
fi

recreate_db
assert_connected_server_is_local "$(command -v psql)" "$(db_uri)"

# --- Preflight rollback: nullable amount must abort without leaving the function ---
echo "-- preflight_rollback"
recreate_db
psql_db -f "$HERE/fixtures/01_roles_and_auth.sql"
psql_db -f "$HERE/fixtures/02_schema.sql"
psql_db -c "alter table public.payments alter column amount drop not null;"
psql_db -f "$HERE/fixtures/03_seed.sql"
set +e
apply_harden >/tmp/harden_preflight.out 2>/tmp/harden_preflight.err
pre_rc=$?
set -e
if [[ $pre_rc -eq 0 ]]; then
  record FAIL "preflight_rollback" "harden unexpectedly succeeded with nullable amount"
else
  exists="$(psql_db -Atc "select to_regprocedure('public.payments_enforce_integrity()') is not null;")"
  if [[ "$exists" == "t" ]]; then
    record FAIL "preflight_rollback" "function remained after failed preflight"
  else
    record PASS "preflight_rollback" "aborted; no leftover function"
  fi
fi

# --- Fresh apply path ---
echo "-- recreate clean DB + fixtures + first apply"
recreate_db
assert_connected_server_is_local "$(command -v psql)" "$(db_uri)"
apply_fixtures

set +e
apply_harden >/tmp/harden_first.out 2>/tmp/harden_first.err
first_rc=$?
set -e
if [[ $first_rc -ne 0 ]]; then
  record FAIL "first_apply" "$(tail -n 8 /tmp/harden_first.err | tr '\n' ' ')"
  echo "First apply failed; stopping further cases."
  print_summary_and_exit
else
  record PASS "first_apply_syntax_and_compile"
fi

set +e
apply_harden >/tmp/harden_second.out 2>/tmp/harden_second.err
second_rc=$?
set -e
if [[ $second_rc -eq 0 ]]; then
  record PASS "idempotent_reapply"
else
  record FAIL "idempotent_reapply" "$(tail -n 8 /tmp/harden_second.err | tr '\n' ' ')"
fi

run_case_file "catalog_asserts" "$HERE/cases/catalog_asserts.sql"
run_case_file "validation_rejects" "$HERE/cases/validation_rejects.sql"
run_case_file "overpay_and_refunds" "$HERE/cases/overpay_and_refunds.sql"

# --- Concurrent payments: two sessions each try 150 against total 200 ---
echo "-- concurrency_payments"
psql_db -c "delete from public.payments where order_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';"
# Seed nothing; both try 150 (total 200) → at most one should succeed if serialized correctly,
# OR both fail if interleaved badly; net must not exceed 200.
set +e
(
  psql "$(db_uri)" -v ON_ERROR_STOP=1 -c "select set_config('app.current_user_id','11111111-1111-1111-1111-111111111111',false);" \
    -c "begin; insert into public.payments(workspace_id,order_id,kind,amount,currency_code,payment_method) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','payment',150,'MDL','cash'); select pg_sleep(1); commit;"
) >/tmp/harden_pay_a.out 2>/tmp/harden_pay_a.err &
pid_a=$!
(
  sleep 0.2
  psql "$(db_uri)" -v ON_ERROR_STOP=1 -c "select set_config('app.current_user_id','11111111-1111-1111-1111-111111111111',false);" \
    -c "begin; insert into public.payments(workspace_id,order_id,kind,amount,currency_code,payment_method) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','payment',150,'MDL','card'); commit;"
) >/tmp/harden_pay_b.out 2>/tmp/harden_pay_b.err &
pid_b=$!
wait "$pid_a"
rc_a=$?
wait "$pid_b"
rc_b=$?
set -e

net_pay="$(psql_db -Atc "select coalesce(sum(case when kind='payment' then amount when kind='refund' then -amount else 0 end),0) from public.payments where order_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';")"
# Expect exactly one success (150) or if both somehow sequenced after refunds none — net <= 200 and not 300
python_ok="$(python3 - <<PY
net=float("$net_pay")
print("yes" if net <= 200.005 and not (abs(net-300)<0.01) else "no")
PY
)"
if [[ "$python_ok" == "yes" && ( "$rc_a" -ne 0 || "$rc_b" -ne 0 ) ]]; then
  record PASS "concurrency_payments" "net=${net_pay} rc_a=${rc_a} rc_b=${rc_b}"
else
  record FAIL "concurrency_payments" "net=${net_pay} rc_a=${rc_a} rc_b=${rc_b} (expected one failure and net<=200)"
fi

# --- Concurrent refunds: original 100, two refunds of 80 ---
echo "-- concurrency_refunds"
psql_db -c "delete from public.payments where order_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';"
psql_db -c "select set_config('app.current_user_id','11111111-1111-1111-1111-111111111111',false); insert into public.payments(workspace_id,order_id,kind,amount,currency_code,payment_method) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','payment',100,'MDL','cash');"
orig="$(psql_db -Atc "select id from public.payments where order_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and kind='payment' limit 1;")"

set +e
(
  psql "$(db_uri)" -v ON_ERROR_STOP=1 -c "select set_config('app.current_user_id','11111111-1111-1111-1111-111111111111',false);" \
    -c "begin; insert into public.payments(workspace_id,order_id,related_payment_id,kind,amount,currency_code,payment_method) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','${orig}','refund',80,'MDL','cash'); select pg_sleep(1); commit;"
) >/tmp/harden_ref_a.out 2>/tmp/harden_ref_a.err &
rpid_a=$!
(
  sleep 0.2
  psql "$(db_uri)" -v ON_ERROR_STOP=1 -c "select set_config('app.current_user_id','11111111-1111-1111-1111-111111111111',false);" \
    -c "begin; insert into public.payments(workspace_id,order_id,related_payment_id,kind,amount,currency_code,payment_method) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','${orig}','refund',80,'MDL','card'); commit;"
) >/tmp/harden_ref_b.out 2>/tmp/harden_ref_b.err &
rpid_b=$!
wait "$rpid_a"
rrc_a=$?
wait "$rpid_b"
rrc_b=$?
set -e

refunded="$(psql_db -Atc "select coalesce(sum(amount),0) from public.payments where related_payment_id='${orig}' and kind='refund';")"
refund_ok="$(python3 - <<PY
r=float("$refunded")
print("yes" if r <= 100.005 and not (abs(r-160)<0.01) else "no")
PY
)"
if [[ "$refund_ok" == "yes" && ( "$rrc_a" -ne 0 || "$rrc_b" -ne 0 ) ]]; then
  record PASS "concurrency_refunds" "refunded=${refunded} rc_a=${rrc_a} rc_b=${rrc_b}"
else
  record FAIL "concurrency_refunds" "refunded=${refunded} rc_a=${rrc_a} rc_b=${rrc_b} (expected one failure and refunded<=100)"
fi

print_summary_and_exit
