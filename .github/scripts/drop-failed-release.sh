#!/bin/sh
# Drops a release whose Build failed: deletes its release branch, so the next
# push to main cuts a fresh release instead of failing on "release branch
# already exists", then tries to close its publish request.
#
# Environment:
#   BRANCH    Release branch whose Build failed, such as release/1.2.3.
#   SHA       Commit that Build ran on. The branch is deleted only while it
#             still points there.
#   RUN_URL   The failed Build run.
#   GH_TOKEN  Token that can delete branches here, and ideally close issues in
#             the publish repository.
# GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER come from GitHub Actions.
set -eu

ref="refs/heads/$BRANCH"
if ! git push --force-with-lease="$ref:$SHA" origin ":$ref"; then
  # The lease fails when the branch is already gone (a rerun) or has moved on.
  # Either way there is nothing to drop. Any other failure is a real one.
  current=$(git ls-remote origin "$ref")
  case "$current" in
    "$SHA"*) exit 1 ;;
  esac
  printf '::notice::%s no longer points at %s. Nothing to drop.\n' "$BRANCH" "$SHA"
  exit 0
fi

# Craft files publish requests in <owner>/publish by default. Closing one is
# tidying up: an open request whose branch is gone cannot publish anything.
publish_repo="$GITHUB_REPOSITORY_OWNER/publish"
title="publish: $GITHUB_REPOSITORY@${BRANCH#release/}"
comment="Superseded: [Build failed]($RUN_URL) on \`$BRANCH\`, so its branch was deleted. The next push to \`main\` prepares a new release."
# List open requests instead of searching: search lags behind new issues.
if ! open_requests=$(gh issue list -R "$publish_repo" --state open --limit 1000 --json number,title); then
  printf '::warning::Could not list publish requests. Close the one for %s by hand.\n' "$BRANCH"
  exit 0
fi
number=$(jq -r --arg t "$title" 'map(select(.title == $t)) | first | .number // empty' <<EOF
$open_requests
EOF
)
if [ -n "$number" ] && ! gh issue close "$number" -R "$publish_repo" --comment "$comment"; then
  printf '::warning::Could not close %s#%s. Close it by hand.\n' "$publish_repo" "$number"
fi
