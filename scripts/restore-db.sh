#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/backup-config.sh" ]]; then
  source "${SCRIPT_DIR}/backup-config.sh"
fi

ARTIFACT_PATH=""
MANIFEST_PATH=""
CHECKSUM_FILE=""
EXPECTED_CHECKSUM=""
TARGET_DATABASE=""
DISPOSABLE_TARGET=false
RESTORE_LOG_FILE="${RESTORE_LOG_FILE:-}"
BACKUP_DECRYPTION_HOOK="${BACKUP_DECRYPTION_HOOK:-}"
POST_RESTORE_CHECK_HOOK="${POST_RESTORE_CHECK_HOOK:-}"
PGHOST="${PGHOST:-}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-}"
PGPASSFILE="${PGPASSFILE:-}"

usage() {
  printf '%s\n' 'Usage: restore-db.sh --artifact PATH --manifest PATH --checksum SHA256 --target-database NAME --disposable-target'
  printf '%s\n' 'The target database must be a newly created disposable project/database. Decryption and post-restore checks are required hooks.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      ARTIFACT_PATH="$2"
      shift 2
      ;;
    --manifest)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      MANIFEST_PATH="$2"
      shift 2
      ;;
    --checksum)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      EXPECTED_CHECKSUM="$2"
      shift 2
      ;;
    --checksum-file)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      CHECKSUM_FILE="$2"
      shift 2
      ;;
    --target-database)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      TARGET_DATABASE="$2"
      shift 2
      ;;
    --disposable-target|--confirm-disposable)
      DISPOSABLE_TARGET=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'ERROR: unsupported argument\n' >&2
      exit 1
      ;;
  esac
done

log() {
  local message="$1"
  if [[ -n "$RESTORE_LOG_FILE" ]]; then
    local timestamp
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    touch "$RESTORE_LOG_FILE"
    chmod 600 "$RESTORE_LOG_FILE"
    printf '%s %s\n' "$timestamp" "$message" >> "$RESTORE_LOG_FILE"
  fi
  printf '%s\n' "$message"
}

fail() {
  log "ERROR: $1"
  exit "${2:-1}"
}

reject_unsafe_path() {
  local path="$1"
  case "/$path/" in
    */../*|*/./*) fail "path traversal is not permitted" ;;
  esac
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* ]] || fail "path contains an invalid control character"
}

canonical_regular_file() {
  local path="$1"
  local parent
  reject_unsafe_path "$path"
  [[ -n "$path" && -f "$path" && ! -L "$path" ]] || fail "artifact input is not a regular non-symlink file"
  parent="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || fail "artifact parent directory is unavailable"
  printf '%s/%s\n' "$parent" "$(basename "$path")"
}

command_available() {
  command -v "$1" >/dev/null 2>&1
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

validate_private_file() {
  local path="$1"
  local mode
  [[ -f "$path" && ! -L "$path" ]] || fail "secret file is not a regular non-symlink file"
  mode="$(file_mode "$path" || true)"
  [[ "$mode" =~ ^[0-7]+$ ]] || fail "secret file permissions could not be verified"
  local numeric_mode=$((8#$mode))
  (( (numeric_mode & 077) == 0 )) || fail "secret file must be owner-readable only"
}

[[ -n "$ARTIFACT_PATH" ]] || fail "artifact path is required"
[[ -n "$MANIFEST_PATH" ]] || fail "manifest path is required"
[[ -n "$TARGET_DATABASE" ]] || fail "an explicit disposable target database is required"
[[ "$DISPOSABLE_TARGET" == true ]] || fail "restore requires the disposable-target confirmation"
[[ "$TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail "target database name is invalid"
[[ -n "$PGHOST" && -n "$PGPORT" && -n "$PGUSER" && -n "$PGPASSFILE" ]] || fail "discrete restore connection settings are required"
[[ "$PGHOST" != *://* && "$PGHOST" != *$'\n'* && "$PGHOST" != *$'\r'* ]] || fail "PGHOST is invalid"
[[ "$TARGET_DATABASE" != "${PGDATABASE:-}" ]] || fail "restore target must differ from the configured database"
[[ "$PGPORT" =~ ^[0-9]+$ ]] && (( PGPORT >= 1 && PGPORT <= 65535 )) || fail "PGPORT is invalid"
[[ "$PGUSER" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "PGUSER is invalid"
validate_private_file "$PGPASSFILE"
export PGPASSFILE
unset PGPASSWORD
[[ -n "$BACKUP_DECRYPTION_HOOK" && -x "$BACKUP_DECRYPTION_HOOK" && ! -L "$BACKUP_DECRYPTION_HOOK" ]] || fail "an approved executable decryption hook is required"
[[ -n "$POST_RESTORE_CHECK_HOOK" && -x "$POST_RESTORE_CHECK_HOOK" && ! -L "$POST_RESTORE_CHECK_HOOK" ]] || fail "a post-restore checks hook is required"
command_available sha256sum || fail "required command is unavailable: sha256sum"
command_available psql || fail "required command is unavailable: psql"
command_available mktemp || fail "required command is unavailable: mktemp"
command_available sed || fail "required command is unavailable: sed"

ARTIFACT_CANONICAL="$(canonical_regular_file "$ARTIFACT_PATH")"
MANIFEST_CANONICAL="$(canonical_regular_file "$MANIFEST_PATH")"
validate_private_file "$ARTIFACT_CANONICAL"
validate_private_file "$MANIFEST_CANONICAL"
[[ -f "$ARTIFACT_CANONICAL" ]] || fail "artifact disappeared during validation"
[[ -f "$MANIFEST_CANONICAL" ]] || fail "manifest disappeared during validation"

if [[ -z "$EXPECTED_CHECKSUM" && -z "$CHECKSUM_FILE" ]]; then
  fail "an explicit SHA-256 checksum is required"
fi

if [[ -n "$CHECKSUM_FILE" ]]; then
  CHECKSUM_CANONICAL="$(canonical_regular_file "$CHECKSUM_FILE")"
  validate_private_file "$CHECKSUM_CANONICAL"
  EXPECTED_CHECKSUM="$(awk 'NF { print $1; exit }' "$CHECKSUM_CANONICAL")"
fi

[[ -n "$EXPECTED_CHECKSUM" ]] || fail "checksum is missing"
EXPECTED_CHECKSUM="${EXPECTED_CHECKSUM,,}"
[[ "$EXPECTED_CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || fail "unknown checksum format"

grep -Eq '"format"[[:space:]]*:[[:space:]]*"elogbook-backup-v1"' "$MANIFEST_CANONICAL" || fail "backup manifest format is not trusted"
MANIFEST_ARTIFACT="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_CANONICAL" | awk 'NR == 1 { print; exit }')"
MANIFEST_SHA256="$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([0-9A-Fa-f]\{64\}\)".*/\1/p' "$MANIFEST_CANONICAL" | awk 'NR == 1 { print; exit }')"
[[ "$MANIFEST_ARTIFACT" =~ ^[A-Za-z0-9._-]+$ ]] || fail "manifest artifact name is invalid"
[[ "$(basename "$ARTIFACT_CANONICAL")" == "$MANIFEST_ARTIFACT" ]] || fail "artifact does not match the manifest"
[[ "$MANIFEST_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "manifest checksum is missing or invalid"
[[ "${MANIFEST_SHA256,,}" == "$EXPECTED_CHECKSUM" ]] || fail "manifest checksum does not match the requested checksum"

ACTUAL_CHECKSUM="$(sha256sum "$ARTIFACT_CANONICAL" | awk '{ print $1 }')"
[[ "$ACTUAL_CHECKSUM" == "$EXPECTED_CHECKSUM" ]] || fail "artifact checksum verification failed"

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/elogbook-restore.XXXXXX")"
chmod 700 "$STAGING"
cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT
PLAIN_PATH="${STAGING}/database.sql"
if ! "$BACKUP_DECRYPTION_HOOK" "$ARTIFACT_CANONICAL" "$PLAIN_PATH" >/dev/null 2>"${STAGING}/decrypt-error"; then
  fail "approved decryption hook failed"
fi
rm -f "${STAGING}/decrypt-error"
[[ -f "$PLAIN_PATH" && ! -L "$PLAIN_PATH" ]] || fail "decryption hook did not create a regular SQL artifact"
chmod 600 "$PLAIN_PATH"

export PGDATABASE="$TARGET_DATABASE"
if ! psql \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$TARGET_DATABASE" \
  --set ON_ERROR_STOP=1 \
  --file "$PLAIN_PATH" >/dev/null 2>"${STAGING}/psql-error"; then
  fail "database restore failed"
fi
rm -f "${STAGING}/psql-error"

if ! "$POST_RESTORE_CHECK_HOOK" "$TARGET_DATABASE" >/dev/null 2>"${STAGING}/post-check-error"; then
  fail "post-restore checks failed"
fi
rm -f "${STAGING}/post-check-error"
log "RESTORE_COMPLETED target=${TARGET_DATABASE}"
