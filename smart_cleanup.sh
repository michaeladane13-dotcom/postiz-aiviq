#!/bin/sh
set -eu

UPLOAD_DIR=/var/lib/docker/volumes/postiz_postiz_uploads/_data
PG_CONTAINER=58931499e356_postiz-postgres-1
TMP_FILE="$(mktemp /run/postiz-protected.XXXXXX)"
FILE_LIST="$(mktemp /run/postiz-mp4-list.XXXXXX)"
trap 'rm -f "$TMP_FILE" "$FILE_LIST"' EXIT

[ -d "$UPLOAD_DIR" ] || { echo "upload directory missing" >&2; exit 1; }
[ "$(docker inspect -f '{{.State.Status}}' "$PG_CONTAINER" 2>/dev/null || true)" = running ] || {
  echo "Postgres is not running; refusing cleanup" >&2
  exit 1
}

docker exec -i "$PG_CONTAINER" psql -U postiz -d postiz -At <<'SQL' |
SELECT DISTINCT regexp_replace(
  CASE WHEN jsonb_typeof(element) = 'object'
       THEN element->>'path'
       ELSE element #>> '{}'
  END,
  '^.*/uploads/', ''
)
FROM "Post" p
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.image::jsonb) = 'array'
        THEN p.image::jsonb
        ELSE '[]'::jsonb
   END
 ) AS item(element)
WHERE p.state IN ('QUEUE', 'ERROR')
  AND p.image IS NOT NULL
  AND p.image NOT IN ('[]', 'null');
SQL
sed -n '/./p' > "$TMP_FILE"

find "$UPLOAD_DIR" -type f -name '*.mp4' -print > "$FILE_LIST"
deleted=0
protected=0
while IFS= read -r filepath; do
  [ -f "$filepath" ] || continue
  relpath="${filepath#$UPLOAD_DIR/}"
  case "$relpath" in
    "$filepath"|/*|../*|*/../*)
      echo "refusing unsafe path: $filepath" >&2
      exit 1
      ;;
  esac
  if grep -Fqx "$relpath" "$TMP_FILE"; then
    protected=$((protected + 1))
  else
    rm -f -- "$filepath"
    deleted=$((deleted + 1))
  fi
done < "$FILE_LIST"

echo "smart cleanup complete: deleted=$deleted protected=$protected"
df -h /
