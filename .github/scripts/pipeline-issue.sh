#!/bin/sh
# Keeps one issue open while the @sentry/api release pipeline is broken, so a
# stuck release gets noticed. `report` opens the issue, or comments on it when
# it is already open. `resolve` closes it.
#
# Usage: pipeline-issue.sh report|resolve
#
# Environment:
#   MESSAGE   Markdown for the new issue, comment, or closing comment.
#   GH_TOKEN  Token with issues: write on this repository.
# GITHUB_REPOSITORY comes from GitHub Actions.
set -eu

title='Release pipeline failing on main'
# Mentioned when the issue opens, which subscribes them to every comment after.
notify=@BYK

action=${1:-}
case "$action" in
  report | resolve) ;;
  *)
    printf 'usage: %s report|resolve\n' "$0" >&2
    exit 2
    ;;
esac

open_issues=$(gh issue list -R "$GITHUB_REPOSITORY" --state open --limit 1000 --json number,title)
number=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | first | .number // empty' <<EOF
$open_issues
EOF
)

if [ "$action" = resolve ]; then
  if [ -z "$number" ]; then
    printf 'No open "%s" issue to close.\n' "$title"
    exit 0
  fi
  gh issue close "$number" -R "$GITHUB_REPOSITORY" --comment "$MESSAGE"
  printf 'Closed #%s.\n' "$number"
  exit 0
fi

if [ -n "$number" ]; then
  gh issue comment "$number" -R "$GITHUB_REPOSITORY" --body "$MESSAGE"
  printf 'Commented on #%s.\n' "$number"
  exit 0
fi

body="The \`@sentry/api\` release pipeline needs attention. New failures are added here as comments, and the next successful Release run closes this issue.

$MESSAGE

cc $notify"
gh issue create -R "$GITHUB_REPOSITORY" --title "$title" --body "$body"
