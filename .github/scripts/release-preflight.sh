#!/bin/sh
# Decides whether an automatic Release run, for a commit whose Build passed on
# main, runs `craft prepare`. Writes proceed=true or proceed=false to
# $GITHUB_OUTPUT.
#
# A release whose Build fails is dropped by drop-failed-release.sh, so any
# release branch still on the remote is a release in progress.
set -eu

remote=origin
newline='
'
head=$(git rev-parse HEAD)

skip() {
  printf '::notice::%s\n' "$1"
  printf 'proceed=false\n' >>"$GITHUB_OUTPUT"
  exit 0
}

# Craft picks the next version from the latest tag in HEAD's history. If a
# newer release exists outside it, HEAD predates that release's merge into main
# (Builds can finish out of order, and a release is tagged before it is
# merged). The Release run for that merge covers whatever is left.
base=$(git describe --tags --abbrev=0)
tags=$(git tag --sort=-version:refname)
newest=${tags%%"$newline"*}
if [ "$newest" != "$base" ]; then
  skip "Release $newest is not in the history of $head yet. The Release run after its merge into main releases whatever is left."
fi

# Release merges and the release commits they bring in are part of $base.
# Anything else is unreleased, including commits that landed while the
# previous release was pending.
unreleased=$(git rev-list --no-merges --count "$base..HEAD")
if [ "$unreleased" -eq 0 ]; then
  skip "Nothing to release: no commits since $base."
fi

# Craft would refuse with "release branch already exists". Merging the pending
# release into main triggers Build and then Release again, and that run
# releases this commit.
pending=$(git ls-remote --heads "$remote" 'refs/heads/release/*')
if [ -n "$pending" ]; then
  skip "A release is still pending. The Release run after its merge into main will release $head."
fi

printf '%s commit(s) since %s to release.\n' "$unreleased" "$base"
printf 'proceed=true\n' >>"$GITHUB_OUTPUT"
