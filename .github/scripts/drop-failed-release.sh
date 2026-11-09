#!/bin/sh
# Drops a release whose Build failed: closes its publish request and deletes its
# release branch, so the next push to main cuts a fresh release instead of
# failing on "release branch already exists". Nobody fixes release branches by
# hand in this auto-release repository.
#
# Environment:
#   BRANCH    Release branch whose Build failed, such as release/1.2.3.
#   SHA       Commit that Build ran on. The branch is deleted only while it
#             still points there.
#   RUN_URL   The failed Build run.
#   GH_TOKEN  Token that can delete branches here and comment on and close
#             issues in the publish repository.
# GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER come from GitHub Actions.
set -eu

remote=origin
# Craft files publish requests in <owner>/publish by default.
publish_repo="$GITHUB_REPOSITORY_OWNER/publish"
ref="refs/heads/$BRANCH"
version=${BRANCH#release/}

current=$(git ls-remote "$remote" "$ref")
if [ -z "$current" ]; then
  printf '::notice::%s is already gone.\n' "$BRANCH"
  exit 0
fi
if [ "${current%%[[:space:]]*}" != "$SHA" ]; then
  printf '::notice::%s no longer points at %s. Leaving it alone.\n' "$BRANCH" "$SHA"
  exit 0
fi

# Craft tags a release when it publishes it, so a tag means it is out already.
tag=$(git ls-remote --tags "$remote" "refs/tags/$version")
if [ -n "$tag" ]; then
  printf '::warning::%s is already tagged. Leaving %s alone.\n' "$version" "$BRANCH"
  exit 0
fi

title="publish: $GITHUB_REPOSITORY@$version"
open_requests=$(gh issue list -R "$publish_repo" --state open --limit 1000 --json number,title)
number=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | first | .number // empty' <<EOF
$open_requests
EOF
)

# Close the request first: if that fails, the branch and the request still
# agree, and the run fails instead of leaving a request behind.
if [ -n "$number" ]; then
  gh issue close "$number" -R "$publish_repo" --comment "Superseded: [Build failed]($RUN_URL) on \`$BRANCH\`, so its branch was deleted. The next push to \`main\` prepares a new release."
  printf '::notice::Closed %s#%s.\n' "$publish_repo" "$number"
fi

# The lease makes the push fail instead of deleting the branch if it moved.
git push --force-with-lease="$ref:$SHA" "$remote" ":$ref"
printf '::notice::Deleted %s (%s).\n' "$BRANCH" "$SHA"
