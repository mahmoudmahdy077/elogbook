#!/usr/bin/env bash
# ============================================================================
# backup-config.sh
#
# Configuration for the E-Logbook database backup script.
# Source this file from backup-db.sh or use as environment defaults.
#
# Usage:
#   source "$(dirname "$0")/backup-config.sh"
# ============================================================================

# --- Backup destination ---
# Directory where compressed SQL dump files are stored.
BACKUP_DIR="${BACKUP_DIR:-/var/elogbook/backups}"

# --- Retention ---
# Number of days to keep daily backups. Older files are purged.
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# --- Database connection ---
# PostgreSQL / Supabase connection URL. Falls back to SUPABASE_DB_URL
# or DATABASE_URL for compatibility with common deployment environments.
DB_URL="${DB_URL:-${SUPABASE_DB_URL:-${DATABASE_URL:-}}}"

# --- Logging ---
LOG_FILE="${LOG_FILE:-/var/log/elogbook/backup.log}"

# --- File naming ---
# Prefix used for backup filenames.
BACKUP_PREFIX="${BACKUP_PREFIX:-elogbook}"

# --- Compression ---
# Compression tool command (must accept stdin -> stdout).
COMPRESS_CMD="${COMPRESS_CMD:-gzip}"
# File extension added by the compression tool.
COMPRESS_EXT="${COMPRESS_EXT:-.gz}"

# --- pg_dump options ---
# Additional flags passed to pg_dump (e.g. --no-owner --no-acl).
PGDUMP_OPTS="${PGDUMP_OPTS:---no-owner --no-acl}"
