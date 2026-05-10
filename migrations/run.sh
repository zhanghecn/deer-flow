#!/bin/sh
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
PGPORT="${PGPORT:-5432}"

require_env() {
    var_name="$1"
    eval "value=\${$var_name:-}"
    if [ -z "$value" ]; then
        echo "Missing required environment variable: $var_name" >&2
        exit 1
    fi
}

psql_cmd() {
    psql \
        -v ON_ERROR_STOP=1 \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        "$@"
}

psql_scalar() {
    psql_cmd -tAc "$1" | tr -d '[:space:]'
}

checksum_file() {
    sha256sum "$1" | awk '{print $1}'
}

record_migration() {
    version="$1"
    checksum="$2"
    psql_cmd \
        -v version="$version" \
        -v checksum="$checksum" \
        <<'SQL'
INSERT INTO openagents_schema_migrations (version, checksum)
VALUES (:'version', :'checksum')
ON CONFLICT (version) DO UPDATE
SET checksum = EXCLUDED.checksum;
SQL
}

adopt_existing_baseline_if_needed() {
    ledger_rows="$(psql_scalar "SELECT COUNT(*) FROM openagents_schema_migrations WHERE version IN ('001_init.up.sql', '002_seed_data.up.sql');")"
    if [ "$ledger_rows" != "0" ]; then
        return
    fi

    sentinel_count="$(psql_scalar "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users', 'models', 'knowledge_build_jobs');")"
    case "$sentinel_count" in
        0)
            return
            ;;
        3)
            # Older deploys applied the two baseline files before the migration
            # ledger existed. Adopt only the complete baseline; a partial schema
            # must be inspected by an operator instead of guessed through.
            for file in "$MIGRATIONS_DIR"/001_init.up.sql "$MIGRATIONS_DIR"/002_seed_data.up.sql; do
                [ -f "$file" ] || {
                    echo "Missing baseline file needed for adoption: $file" >&2
                    exit 1
                }
                record_migration "$(basename "$file")" "$(checksum_file "$file")"
            done
            echo "Adopted existing baseline schema into openagents_schema_migrations"
            ;;
        *)
            echo "Existing database has a partial OpenAgents schema ($sentinel_count/3 sentinel tables). Refusing automatic migration." >&2
            exit 1
            ;;
    esac
}

require_env PGHOST
require_env PGDATABASE
require_env PGUSER
require_env PGPASSWORD

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "Migration directory does not exist: $MIGRATIONS_DIR" >&2
    exit 1
fi

# The ledger is owned by the deploy migration service, not by gateway startup.
# It lets first-run initialization and later reviewed SQL files share one path.
psql_cmd <<'SQL'
CREATE TABLE IF NOT EXISTS openagents_schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

adopt_existing_baseline_if_needed

found_sql=0
for file in "$MIGRATIONS_DIR"/*.up.sql; do
    [ -e "$file" ] || continue
    found_sql=1

    version="$(basename "$file")"
    checksum="$(checksum_file "$file")"
    applied_checksum="$(psql_scalar "SELECT COALESCE((SELECT checksum FROM openagents_schema_migrations WHERE version = '$version'), '');")"

    if [ -n "$applied_checksum" ]; then
        if [ "$applied_checksum" != "$checksum" ]; then
            echo "Migration checksum changed after application: $version" >&2
            exit 1
        fi
        echo "Skipping already applied migration: $version"
        continue
    fi

    echo "Applying migration: $version"
    psql_cmd -f "$file"
    record_migration "$version" "$checksum"
done

if [ "$found_sql" = "0" ]; then
    echo "No *.up.sql files found in $MIGRATIONS_DIR" >&2
    exit 1
fi

echo "OpenAgents database migrations are up to date"
