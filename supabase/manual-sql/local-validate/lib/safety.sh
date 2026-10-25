#!/usr/bin/env bash
# Local-only connection guards for harden ledger SQL validation.

safety_die() {
  echo "ERROR: $*" >&2
  exit 1
}

# Refuse anything that looks like Supabase / cloud hosts before connecting.
assert_host_is_local() {
  local host="${PGHOST:-127.0.0.1}"
  case "$host" in
    127.0.0.1|localhost|::1) ;;
    "")
      # Empty PGHOST ⇒ unix socket; treat as local-only intent.
      ;;
    *)
      safety_die "Refusing non-local PGHOST='$host'. Set PGHOST=127.0.0.1"
      ;;
  esac

  local lower
  lower="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *supabase* || "$lower" == *neon.tech* || "$lower" == *amazonaws* || "$lower" == *pooler* ]]; then
    safety_die "Refusing remote-looking PGHOST='$host'"
  fi
}

# After connect: confirm server address is loopback or unix socket (NULL).
assert_connected_server_is_local() {
  local psql_bin="$1"
  local uri="$2"
  local probe
  probe="$("$psql_bin" "$uri" -v ON_ERROR_STOP=1 -Atc \
    "select coalesce(host(inet_server_addr()), 'unix-socket');")"
  case "$probe" in
    127.0.0.1|::1|unix-socket) ;;
    *)
      safety_die "Connected server address '$probe' is not local loopback/unix socket. Aborting."
      ;;
  esac

  local dbname
  dbname="$("$psql_bin" "$uri" -v ON_ERROR_STOP=1 -Atc "select current_database();")"
  if [[ "$dbname" != "${HARDEN_LOCAL_DB:?}" ]]; then
    safety_die "Connected to unexpected database '$dbname' (want ${HARDEN_LOCAL_DB})"
  fi
}
