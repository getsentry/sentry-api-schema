#!/bin/sh
# Decides whether an automatic Release run cuts a release from HEAD, a commit
# whose Build passed on main. Writes proceed=true or proceed=false to
# $GITHUB_OUTPUT. Each skip is a case where `craft prepare` would fail.
set -eu

skip() {
  printf '::notice::%s\n' "$1"
  printf 'proceed=false\n' >>"$GITHUB_OUTPUT"
  exit 0
}

# "Release branch already exists". Once that release merges into main, the
# Release run for the merge commit releases whatever landed meanwhile.
pending=$(git ls-remote --heads origin 'refs/heads/release/*')
if [ -n "$pending" ]; then
  skip 'A release is still pending.'
fi

# Craft takes the next version from the latest tag in HEAD's history. A newer
# tag outside it means HEAD predates a release, and craft would cut that
# version again.
base=$(git describe --tags --abbrev=0)
tags=$(git tag --sort=-version:refname)
newest=${tags%%[[:space:]]*}
if [ "$newest" != "$base" ]; then
  skip "HEAD predates release $newest."
fi

# "No commits found since the last release". Release merges count as released.
unreleased=$(git rev-list --no-merges "$base..HEAD")
if [ -z "$unreleased" ]; then
  skip "Nothing to release since $base."
fi

printf 'proceed=true\n' >>"$GITHUB_OUTPUT"
