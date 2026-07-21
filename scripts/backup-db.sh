#!/usr/bin/env bash
# ============================================================================
# backup-db.sh
#
# E-Logbook PostgreSQL database backup script.
#
# Creates a timestamped, compressed SQL dump of the Supabase PostgreSQL
# database, enforces a retention policy, and logs all operations.
#
# Usage:
#   ./backup-db.sh                     # Run a backup (requires DB_URL)
#   ./backup-db.sh --dry-run           # Show what would be done
#   SUPABASE_DB_URL=postgresql://... ./backup-db.sh
#
# Environment variables (see backup-config.sh):
#   SUPABASE_DB_URL or DB_URL or DATABASE_URL  — connection string
#   BACKUP_DIR          — output directory (default: /var/elogbook/backups)
#   RETENTION_DAYS      — max age in days before cleanup (default: 30)
#   LOG_FILE            — log path (default: /var/log/elogbook/backup.log)
#
# Dependencies:
#   pg_dump (PostgreSQL client), gzip
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Source configuration ──────────────────────────────────────────────────
if [[ -f "${SCRIPT_DIR}/backup-config.sh" ]]; then
  # shellcheck source=./backup-config.sh
  source "${SCRIPT_DIR}/backup-config.sh"
fi

# ── Overridable defaults (when config is missing) ──────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/elogbook/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/elogbook/backup.log}"
DB_URL="${DB_URL:-${SUPABASE_DB_URL:-${DATABASE_URL:-}}}"
COMPRESS_CMD="${COMPRESS_CMD:-gzip}"
COMPRESS_EXT="${COMPRESS_EXT:-.gz}"
PGDUMP_OPTS="${PGDUMP_OPTS:---no-owner --no-acl}"
BACKUP_PREFIX="${BACKUP_PREFIX:-elogbook}"

# ── Flags ──────────────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: $0 [--dry-run]"
      echo ""
      echo "  --dry-run    Print actions without executing them"
      exit 0
      ;;
  esac
done

# ── Dry-run helper ─────────────────────────────────────────────────────────
run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# ── Logging ────────────────────────────────────────────────────────────────
log() {
  local level="$1"
  local msg="$2"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "${ts} [${level}] ${msg}" >> "${LOG_FILE}"
  echo "${ts} [${level}] ${msg}"
}

# ── Ensure log directory exists before any log calls ──────────────────────
mkdir -p "$(dirname "${LOG_FILE}")"

# ── Pre-flight checks ──────────────────────────────────────────────────────
if [[ -z "${DB_URL}" ]]; then
  log "ERROR" "Database URL not set. Provide SUPABASE_DB_URL, DB_URL, or DATABASE_URL."
  exit 1
fi

for cmd in pg_dump "${COMPRESS_CMD}"; do
  if ! command -v "${cmd}" &>/dev/null; then
    log "ERROR" "Required command not found: ${cmd}"
    exit 1
  fi
done

# ── Main ───────────────────────────────────────────────────────────────────

# 1. Create backup directory
run mkdir -p "${BACKUP_DIR}"

# 2. Determine filename
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}-db-${TIMESTAMP}.sql"
COMPRESSED_FILE="${DUMP_FILE}${COMPRESS_EXT}"

log "INFO" "Starting backup → ${COMPRESSED_FILE}"

if [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] pg_dump \"${DB_URL}\" ${PGDUMP_OPTS} -f \"${DUMP_FILE}\""
  echo "[DRY-RUN] ${COMPRESS_CMD} \"${DUMP_FILE}\""
else
  # 4. Run pg_dump
  if pg_dump "${DB_URL}" ${PGDUMP_OPTS} -f "${DUMP_FILE}"; then
    # 5. Compress
    if ${COMPRESS_CMD} "${DUMP_FILE}"; then
      # 6. Check resulting file
      if [[ -f "${COMPRESSED_FILE}" ]]; then
        FILE_SIZE="$(stat -c %s "${COMPRESSED_FILE}")"
        log "INFO" "Backup complete: ${COMPRESSED_FILE} (${FILE_SIZE} bytes)"
      else
        log "WARN" "Compressed file not found after compression: ${COMPRESSED_FILE}"
      fi
    else
      log "ERROR" "Compression failed for ${DUMP_FILE}"
      exit 2
    fi
  else
    log "ERROR" "pg_dump failed"
    exit 2
  fi
fi

# 7. Retention cleanup — remove files older than RETENTION_DAYS
log "INFO" "Cleaning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"

if [[ "$DRY_RUN" == true ]]; then
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-db-*.sql${COMPRESS_EXT}" \
    -mtime "+${RETENTION_DAYS}" -print \
    | while IFS= read -r f; do
        echo "[DRY-RUN] rm \"${f}\""
      done
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-db-*.sql" \
    -mtime "+${RETENTION_DAYS}" -print \
    | while IFS= read -r f; do
        echo "[DRY-RUN] rm \"${f}\""
      done
else
  DELETED_COUNT=0
  while IFS= read -r f; do
    rm -f "${f}"
    log "INFO" "Removed expired backup: ${f}"
    ((DELETED_COUNT++))
  done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f \( \
    -name "${BACKUP_PREFIX}-db-*.sql${COMPRESS_EXT}" \
    -o -name "${BACKUP_PREFIX}-db-*.sql" \
  \) -mtime "+${RETENTION_DAYS}" -print)

  log "INFO" "Cleanup complete: removed ${DELETED_COUNT} expired backup(s)"
fi

log "INFO" "Backup run finished"
