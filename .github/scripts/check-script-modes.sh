#!/bin/sh
# Fails when a script in .github/scripts is not committed as executable.
# Workflows run these scripts directly. A script committed as 100644 only fails
# when a workflow reaches it, with exit 126 ("Permission denied"). For Release,
# that is after the merge.
set -eu

files=$(git ls-files -s .github/scripts)
status=0
while read -r mode _ _ path; do
  [ -n "$path" ] || continue
  [ "$mode" = 100755 ] && continue
  printf '::error file=%s::%s has mode %s. Run: git update-index --chmod=+x %s\n' \
    "$path" "$path" "$mode" "$path"
  status=1
done <<LIST
$files
LIST
exit "$status"
