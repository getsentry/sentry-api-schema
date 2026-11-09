#!/bin/sh
# Reports a stuck @sentry/api release through pipeline-issue.sh. A release is
# stuck when a "Generated" schema commit on main has waited more than a day to
# reach npm, or when a publish request has had failed CI for more than a day.
#
# Run from a checkout of main with full history and tags.
#
# Environment:
#   GH_TOKEN  Token that can read this repository's and the publish
#             repository's issues, and write this repository's issues.
# GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER and GITHUB_SERVER_URL come from
# GitHub Actions.
set -eu

max_age=86400
here=$(dirname "$0")
repo_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY"
# Craft files publish requests in <owner>/publish by default.
publish_repo="$GITHUB_REPOSITORY_OWNER/publish"
now=$(date +%s)
problems=

package=$(jq -er .name package.json)
latest=$(npm view "$package" version)

if ! git rev-parse -q --verify "refs/tags/$latest^{commit}" >/dev/null; then
  problems="$problems
- \`$package@$latest\` is the newest version on npm, but this repository has no \`$latest\` tag."
else
  # Oldest first, so the first line is the commit that has waited longest.
  waiting=$(git log --no-merges --reverse --grep='^Generated$' --format='%H %ct' "$latest..HEAD")
  read -r sha committed <<EOF
$waiting
EOF
  if [ -n "$sha" ] && [ $((now - committed)) -gt "$max_age" ]; then
    count=$(git rev-list --no-merges --count --grep='^Generated$' "$latest..HEAD")
    problems="$problems
- $count \"Generated\" commit(s) on \`main\` are not on npm yet. The oldest, [\`$sha\`]($repo_url/commit/$sha), landed $(((now - committed) / 3600))h ago. The newest npm release is \`$package@$latest\`."
  fi
fi

# --paginate prints one JSON array per page, so jq reads them with `inputs`.
requests=$(gh api --paginate "repos/$publish_repo/issues?state=open&labels=ci-failed&per_page=100")
numbers=$(jq -nr --arg p "publish: $GITHUB_REPOSITORY@" 'inputs[] | select(.title | startswith($p)) | .number' <<EOF
$requests
EOF
)
for number in $numbers; do
  events=$(gh api --paginate "repos/$publish_repo/issues/$number/events")
  failed_at=$(jq -n '[inputs[] | select(.event == "labeled" and .label.name == "ci-failed") | .created_at | fromdateiso8601] | max // empty' <<EOF
$events
EOF
)
  if [ -n "$failed_at" ] && [ $((now - failed_at)) -gt "$max_age" ]; then
    problems="$problems
- $publish_repo#$number has had failed CI for $(((now - failed_at) / 3600))h."
  fi
done

if [ -z "$problems" ]; then
  printf 'The %s release is up to date.\n' "$package"
  exit 0
fi

printf 'Found a stuck release:%s\n' "$problems"
MESSAGE="The daily staleness check found a stuck release:$problems" "$here/pipeline-issue.sh" report
