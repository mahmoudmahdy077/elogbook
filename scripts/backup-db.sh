#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/backup-config.sh" ]]; then
  source "${SCRIPT_DIR}/backup-config.sh"
fi

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      printf '%s\n' 'Usage: backup-db.sh [--dry-run]'
      printf '%s\n' 'Production requires discrete PGHOST/PGPORT/PGUSER/PGDATABASE values, PGPASSFILE, an approved encryption hook, and durable upload/checksum hooks.'
      exit 0
      ;;
    *)
      printf 'ERROR: unsupported argument\n' >&2
      exit 1
      ;;
  esac
done

if [[ "$DRY_RUN" == true ]]; then
  printf '%s\n' '[DRY-RUN] validate discrete connection settings, encrypt local artifacts, and verify durable remote checksums'
  exit 0
fi

BACKUP_DIR="${BACKUP_DIR:-/var/elogbook/backups}"
LOG_FILE="${LOG_FILE:-${BACKUP_DIR}/backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-elogbook}"
BACKUP_OBJECT_PREFIX="${BACKUP_OBJECT_PREFIX:-elogbook/backups}"
BACKUP_STORAGE_PROVIDER="${BACKUP_STORAGE_PROVIDER:-}"
BACKUP_ENCRYPTION_PROVIDER="${BACKUP_ENCRYPTION_PROVIDER:-}"
BACKUP_ENCRYPTION_HOOK="${BACKUP_ENCRYPTION_HOOK:-}"
BACKUP_KMS_PROVIDER="${BACKUP_KMS_PROVIDER:-}"
BACKUP_KMS_KEY_REFERENCE="${BACKUP_KMS_KEY_REFERENCE:-}"
BACKUP_KMS_VERIFY_HOOK="${BACKUP_KMS_VERIFY_HOOK:-}"
BACKUP_OBJECT_LOCK_MODE="${BACKUP_OBJECT_LOCK_MODE:-}"
BACKUP_OBJECT_LOCK_RETENTION_DAYS="${BACKUP_OBJECT_LOCK_RETENTION_DAYS:-}"
BACKUP_OBJECT_LOCK_VERIFY_HOOK="${BACKUP_OBJECT_LOCK_VERIFY_HOOK:-}"
BACKUP_UPLOAD_HOOK="${BACKUP_UPLOAD_HOOK:-}"
BACKUP_REMOTE_VERIFY_HOOK="${BACKUP_REMOTE_VERIFY_HOOK:-}"
BACKUP_CONFIG_SOURCE="${BACKUP_CONFIG_SOURCE:-}"
BACKUP_TEST_MODE="${BACKUP_TEST_MODE:-0}"
PGHOST="${PGHOST:-}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-}"
PGDATABASE="${PGDATABASE:-}"
PGPASSFILE="${PGPASSFILE:-}"

ensure_directory() {
  local directory="$1"
  [[ "$directory" != /* ]] && return 1
  if [[ -e "$directory" && ! -d "$directory" ]]; then
    return 1
  fi
  mkdir -p "$directory"
  chmod 700 "$directory"
}

if ! ensure_directory "$BACKUP_DIR"; then
  printf 'ERROR: backup directory is not an absolute writable directory\n' >&2
  exit 1
fi

LOG_DIRECTORY="$(dirname "$LOG_FILE")"
if ! mkdir -p "$LOG_DIRECTORY"; then
  printf 'ERROR: log directory is not writable\n' >&2
  exit 1
fi
if ! : > "$LOG_FILE"; then
  printf 'ERROR: log file is not writable\n' >&2
  exit 1
fi
chmod 600 "$LOG_FILE"

log() {
  local level="$1"
  local message="$2"
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s [%s] %s\n' "$timestamp" "$level" "$message" >> "$LOG_FILE"
  printf '%s [%s] %s\n' "$timestamp" "$level" "$message"
}

fail() {
  log ERROR "$1"
  exit "${2:-1}"
}

is_test_mode() {
  if [[ "$BACKUP_TEST_MODE" == "1" || "$BACKUP_TEST_MODE" == "true" ]]; then
    [[ "${NODE_ENV:-}" != "production" && "${BACKUP_ENVIRONMENT:-}" != "production" ]] || fail "local test mode is forbidden in production"
    return 0
  fi
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

require_hook() {
  local hook_path="$1"
  [[ -n "$hook_path" && -x "$hook_path" ]] || fail "an approved executable hook is required"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

file_size() {
  stat -c '%s' "$1" 2>/dev/null || stat -f '%z' "$1" 2>/dev/null
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

validate_value() {
  local name="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "missing required setting: $name"
  [[ "$value" != *://* && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "invalid setting: $name"
}

validate_prefix() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9._:/-]+$ ]] || fail "backup object prefix is invalid"
  [[ "$value" != /* && "$value" != *..* && "$value" != *//* ]] || fail "backup object prefix is invalid"
}

run_encrypt_hook() {
  local input_path="$1"
  local output_path="$2"
  local error_path="$STAGING/encrypt-hook-error"
  require_hook "$BACKUP_ENCRYPTION_HOOK"
  [[ ! -e "$output_path" ]] || fail "encrypted output already exists"
  if ! "$BACKUP_ENCRYPTION_HOOK" "$input_path" "$output_path" >/dev/null 2>"$error_path"; then
    rm -f "$error_path"
    fail "approved encryption hook failed"
  fi
  rm -f "$error_path"
  [[ -f "$output_path" && ! -L "$output_path" ]] || fail "encryption hook did not create a regular artifact"
  chmod 600 "$output_path"
  [[ "$(file_size "$output_path")" -gt 0 ]] || fail "encryption hook created an empty artifact"
}

run_upload_hook() {
  local source_path="$1"
  local object_key="$2"
  local expected_checksum="$3"
  local error_path="$STAGING/upload-hook-error"
  require_hook "$BACKUP_UPLOAD_HOOK"
  if ! "$BACKUP_UPLOAD_HOOK" "$source_path" "$object_key" "$expected_checksum" >/dev/null 2>"$error_path"; then
    rm -f "$error_path"
    fail "durable upload hook failed"
  fi
  rm -f "$error_path"
}

validate_provider_value() {
  local name="$1"
  local value="$2"
  validate_value "$name" "$value"
  [[ "$value" =~ ^[A-Za-z0-9._:/-]+$ ]] || fail "$name is invalid"
  [[ ! "${value,,}" =~ (local|placeholder|replace|example|dummy|test|fixture|changeme) ]] || fail "$name is not production-approved"
}

run_verification_hook() {
  local name="$1"
  local hook_path="$2"
  shift 2
  local output_path="$STAGING/${name}-verification-output"
  local error_path="$STAGING/${name}-verification-error"
  local result
  require_hook "$hook_path"
  if ! "$hook_path" "$@" >"$output_path" 2>"$error_path"; then
    rm -f "$output_path" "$error_path"
    fail "$name verification failed"
  fi
  result="$(awk 'NF { print $1 }' "$output_path")"
  rm -f "$output_path" "$error_path"
  [[ "$result" == "verified" ]] || fail "$name verification did not return an approved result"
}

run_kms_verification() {
  run_verification_hook "kms" "$BACKUP_KMS_VERIFY_HOOK" "$BACKUP_KMS_PROVIDER" "$BACKUP_KMS_KEY_REFERENCE"
}

run_object_lock_verification() {
  local object_key="$1"
  run_verification_hook "object-lock" "$BACKUP_OBJECT_LOCK_VERIFY_HOOK" "$object_key" "$BACKUP_OBJECT_LOCK_MODE" "$BACKUP_OBJECT_LOCK_RETENTION_DAYS"
}

run_remote_verify_hook() {
  local object_key="$1"
  local expected_checksum="$2"
  local output_path="$STAGING/remote-checksum"
  local error_path="$STAGING/remote-verify-error"
  local remote_checksum
  require_hook "$BACKUP_REMOTE_VERIFY_HOOK"
  if ! "$BACKUP_REMOTE_VERIFY_HOOK" "$object_key" "$expected_checksum" >"$output_path" 2>"$error_path"; then
    rm -f "$output_path" "$error_path"
    fail "remote checksum verification hook failed"
  fi
  remote_checksum="$(awk 'NF { print $1 }' "$output_path")"
  rm -f "$output_path" "$error_path"
  [[ "$remote_checksum" =~ ^[0-9a-fA-F]{64}$ ]] || fail "remote checksum is not a SHA-256 digest"
  remote_checksum="${remote_checksum,,}"
  [[ "$remote_checksum" == "$expected_checksum" ]] || fail "remote checksum does not match the local manifest"
}

for command_name in pg_dump gzip sha256sum stat date mktemp chmod mkdir awk find; do
  require_command "$command_name"
done

validate_value PGHOST "$PGHOST"
validate_value PGPORT "$PGPORT"
validate_value PGUSER "$PGUSER"
validate_value PGDATABASE "$PGDATABASE"
validate_value PGPASSFILE "$PGPASSFILE"
[[ "$PGPORT" =~ ^[0-9]+$ ]] && (( PGPORT >= 1 && PGPORT <= 65535 )) || fail "PGPORT is invalid"
[[ "$PGUSER" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "PGUSER is invalid"
[[ "$PGDATABASE" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "PGDATABASE is invalid"
validate_private_file "$PGPASSFILE"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "RETENTION_DAYS is invalid"
[[ "$BACKUP_PREFIX" =~ ^[A-Za-z0-9_-]+$ ]] || fail "BACKUP_PREFIX is invalid"
validate_prefix "$BACKUP_OBJECT_PREFIX"
validate_provider_value BACKUP_ENCRYPTION_PROVIDER "$BACKUP_ENCRYPTION_PROVIDER"
require_hook "$BACKUP_ENCRYPTION_HOOK"

if ! is_test_mode; then
  validate_provider_value BACKUP_STORAGE_PROVIDER "$BACKUP_STORAGE_PROVIDER"
  validate_provider_value BACKUP_KMS_PROVIDER "$BACKUP_KMS_PROVIDER"
  validate_provider_value BACKUP_KMS_KEY_REFERENCE "$BACKUP_KMS_KEY_REFERENCE"
  require_hook "$BACKUP_KMS_VERIFY_HOOK"
  [[ "$BACKUP_OBJECT_LOCK_MODE" =~ ^(compliance|governance)$ ]] || fail "BACKUP_OBJECT_LOCK_MODE is invalid"
  [[ "$BACKUP_OBJECT_LOCK_RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_OBJECT_LOCK_RETENTION_DAYS is invalid"
  (( BACKUP_OBJECT_LOCK_RETENTION_DAYS >= 1 && BACKUP_OBJECT_LOCK_RETENTION_DAYS <= 3650 )) || fail "BACKUP_OBJECT_LOCK_RETENTION_DAYS is invalid"
  require_hook "$BACKUP_OBJECT_LOCK_VERIFY_HOOK"
  require_hook "$BACKUP_UPLOAD_HOOK"
  require_hook "$BACKUP_REMOTE_VERIFY_HOOK"
fi

if [[ -n "$BACKUP_CONFIG_SOURCE" && ( ! -f "$BACKUP_CONFIG_SOURCE" || -L "$BACKUP_CONFIG_SOURCE" ) ]]; then
  fail "BACKUP_CONFIG_SOURCE must be a regular non-symlink file"
fi

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/elogbook-backup.XXXXXX")"
chmod 700 "$STAGING"
cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT

if ! is_test_mode; then
  run_kms_verification
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${BACKUP_PREFIX}-${TIMESTAMP}"
DUMP_NAME="${RUN_ID}.db.enc"
CONFIG_NAME="${RUN_ID}.config.enc"
MANIFEST_NAME="${RUN_ID}.manifest.json"
CHECKSUM_NAME="${RUN_ID}.sha256"
DUMP_PATH="${BACKUP_DIR}/${DUMP_NAME}"
CONFIG_PATH="${BACKUP_DIR}/${CONFIG_NAME}"
MANIFEST_PATH="${BACKUP_DIR}/${MANIFEST_NAME}"
CHECKSUM_PATH="${BACKUP_DIR}/${CHECKSUM_NAME}"
RAW_DUMP_PATH="${STAGING}/database.sql.gz"
RAW_CONFIG_PATH="${STAGING}/config.json"
PG_ERROR_PATH="${STAGING}/pg-dump-error"

log INFO "starting encrypted backup run ${RUN_ID}"

if ! pg_dump \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$PGDATABASE" \
  --format=plain \
  --no-owner \
  --no-acl 2>"$PG_ERROR_PATH" | gzip -n > "$RAW_DUMP_PATH"; then
  rm -f "$PG_ERROR_PATH"
  fail "database dump failed"
fi
rm -f "$PG_ERROR_PATH"
gzip -t "$RAW_DUMP_PATH" >/dev/null
[[ "$(file_size "$RAW_DUMP_PATH")" -gt 0 ]] || fail "database dump is empty"

if [[ -n "$BACKUP_CONFIG_SOURCE" ]]; then
  cp -- "$BACKUP_CONFIG_SOURCE" "$RAW_CONFIG_PATH"
else
  printf '%s\n' '{"format":"elogbook-backup-config-v1","included":false}' > "$RAW_CONFIG_PATH"
fi
chmod 600 "$RAW_CONFIG_PATH"

run_encrypt_hook "$RAW_DUMP_PATH" "$DUMP_PATH"
run_encrypt_hook "$RAW_CONFIG_PATH" "$CONFIG_PATH"

DUMP_SHA256="$(sha256sum "$DUMP_PATH" | awk '{print $1}')"
CONFIG_SHA256="$(sha256sum "$CONFIG_PATH" | awk '{print $1}')"
[[ "$DUMP_SHA256" =~ ^[0-9a-f]{64}$ && "$CONFIG_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "local SHA-256 generation failed"
KEY_REFERENCE_SHA256="$(printf '%s' "$BACKUP_KMS_KEY_REFERENCE" | sha256sum | awk '{print $1}')"

printf '%s\n' \
  '{' \
  '  "format": "elogbook-backup-v1",' \
  "  \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
  "  \"run_id\": \"${RUN_ID}\"," \
  "  \"encryption_provider\": \"${BACKUP_ENCRYPTION_PROVIDER}\"," \
  "  \"storage_provider\": \"${BACKUP_STORAGE_PROVIDER:-local-test-only}\"," \
  "  \"key_management_provider\": \"${BACKUP_KMS_PROVIDER:-local-test-only}\"," \
  "  \"key_reference_sha256\": \"${KEY_REFERENCE_SHA256}\"," \
  "  \"object_lock_mode\": \"${BACKUP_OBJECT_LOCK_MODE:-local-test-only}\"," \
  "  \"object_lock_retention_days\": ${BACKUP_OBJECT_LOCK_RETENTION_DAYS:-0}," \
  '  "checksum_algorithm": "SHA-256",' \
  '  "artifacts": [' \
  "    {\"name\": \"${DUMP_NAME}\", \"kind\": \"database\", \"sha256\": \"${DUMP_SHA256}\"}," \
  "    {\"name\": \"${CONFIG_NAME}\", \"kind\": \"config\", \"sha256\": \"${CONFIG_SHA256}\"}" \
  '  ]' \
  '}' > "$MANIFEST_PATH"
chmod 600 "$MANIFEST_PATH"

(
  cd "$BACKUP_DIR"
  sha256sum "$DUMP_NAME" "$CONFIG_NAME" "$MANIFEST_NAME"
) > "$CHECKSUM_PATH"
chmod 600 "$CHECKSUM_PATH"
(cd "$BACKUP_DIR" && sha256sum -c --strict "$CHECKSUM_NAME") >/dev/null

if is_test_mode; then
  log INFO "local test artifacts generated; no durable status is reported"
  printf 'LOCAL_TEST_ONLY %s\n' "$RUN_ID"
  exit 0
fi

upload_and_verify() {
  local path="$1"
  local name
  local object_key
  local expected_checksum
  name="$(basename "$path")"
  object_key="${BACKUP_OBJECT_PREFIX}/${name}"
  expected_checksum="$(sha256sum "$path" | awk '{print $1}')"
  run_upload_hook "$path" "$object_key" "$expected_checksum"
  run_remote_verify_hook "$object_key" "$expected_checksum"
  run_object_lock_verification "$object_key"
}

upload_and_verify "$DUMP_PATH"
upload_and_verify "$CONFIG_PATH"
upload_and_verify "$MANIFEST_PATH"
upload_and_verify "$CHECKSUM_PATH"

log INFO "durable backup object set verified: ${RUN_ID}"
printf 'BACKUP_DURABLE_SUCCESS %s\n' "$RUN_ID"

while IFS= read -r expired_path; do
  rm -f "$expired_path"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( \
  -name "${BACKUP_PREFIX}-*.enc" \
  -o -name "${BACKUP_PREFIX}-*.manifest.json" \
  -o -name "${BACKUP_PREFIX}-*.sha256" \
\) -mtime "+${RETENTION_DAYS}" -print)
