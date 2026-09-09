#!/bin/sh
set -eu

if [ $# -lt 1 ]; then
  echo "usage: ./src/snapshot.sh \"what changed\"" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
python3 src/archive.py "$1"

BACKUP="${RESUME_BACKUP:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/resume-archive}"
if [ -d "$(dirname "$BACKUP")" ]; then
  mkdir -p "$BACKUP"
  STAMP=$(date +%Y-%m-%d)
  tar -czf "$BACKUP/resume-archive-$STAMP.tar.gz" archive
  cp archive/manifest.json "$BACKUP/manifest.json"
  python3 - "$BACKUP" <<'PY'
import pathlib
import sys

backups = sorted(pathlib.Path(sys.argv[1]).glob("resume-archive-*.tar.gz"),
                 key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)
for old in backups[5:]:
    old.unlink()
PY
  echo
  echo "backed up to $BACKUP"
  ls -1t "$BACKUP"/resume-archive-*.tar.gz | head -5
else
  echo
  echo "WARNING: no backup target at $BACKUP" >&2
  echo "archive/ is gitignored, so it now exists on this disk only." >&2
  echo "Set RESUME_BACKUP to a synced or external directory and re-run." >&2
fi

echo
echo "commit it with:  git add -A && git commit --amend --no-edit && git push --force-with-lease origin main"
