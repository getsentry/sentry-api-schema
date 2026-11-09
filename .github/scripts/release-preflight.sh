#!/bin/sh
# Decides whether the Release workflow runs `craft prepare`, and clears release
# branches whose publish request can no longer finish, so a failed release does
# not block every later one.
#
# Writes proceed=true or proceed=false to $GITHUB_OUTPUT.
#
# Environment:
#   RELEASE_TRIGGER  github.event_name. "workflow_run" means an automatic
#                    release of HEAD after its Build passed; manual releases
#                    skip the checks that only make sense for those.
#   GH_TOKEN         Token that can delete release branches here and read,
#                    comment on, and close issues in the publish repository.
# GITHUB_OUTPUT, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER, GITHUB_RUN_ID and
# GITHUB_SERVER_URL come from GitHub Actions.
set -eu

remote=origin
# Craft files publish requests in <owner>/publish by default.
publish_repo="$GITHUB_REPOSITORY_OWNER/publish"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
head=$(git rev-parse HEAD)
newline='
'

if [ "$RELEASE_TRIGGER" = workflow_run ]; then
  # Craft picks the next version from the latest tag in HEAD's history. If a
  # newer release exists outside it, HEAD predates that release's merge into
  # main (Builds can finish out of order, and a release is tagged before it is
  # merged). The Release run for that merge covers this commit instead.
  base=$(git describe --tags --abbrev=0)
  tags=$(git tag --sort=-version:refname)
  newest=${tags%%"$newline"*}
  if [ "$newest" != "$base" ]; then
    printf '::notice::Release %s is not in the history of %s yet. The Release run after its merge into main releases whatever is left.\n' "$newest" "$head"
    printf 'proceed=false\n' >>"$GITHUB_OUTPUT"
    exit 0
  fi

  # Release merges and the release commits they bring in are part of $base.
  # Anything else is unreleased, including commits that landed while the
  # previous release was pending.
  unreleased=$(git rev-list --no-merges --count "$base..HEAD")
  if [ "$unreleased" -eq 0 ]; then
    printf '::notice::Nothing to release: no commits since %s.\n' "$base"
    printf 'proceed=false\n' >>"$GITHUB_OUTPUT"
    exit 0
  fi
  printf '%s commit(s) since %s to release.\n' "$unreleased" "$base"
fi

package=$(jq -er .name package.json)
npm_versions=$(npm view "$package" versions --json)
branches=$(git ls-remote --heads "$remote" 'refs/heads/release/*')
open_requests=$(gh issue list -R "$publish_repo" --state open --limit 1000 --json number,title,labels)
pending=

while read -r sha ref; do
  [ -n "$ref" ] || continue
  branch=${ref#refs/heads/}
  version=${branch#release/}

  published=$(jq -r --arg v "$version" 'if type == "array" then . else [.] end | index($v) != null' <<EOF
$npm_versions
EOF
)
  if [ "$published" = true ]; then
    printf '::warning::%s is still on the remote, but %s@%s is already on npm. Leaving it alone.\n' "$branch" "$package" "$version"
    continue
  fi

  title="publish: $GITHUB_REPOSITORY@$version"
  request=$(jq -c --arg t "$title" '[.[] | select(.title == $t)] | first // empty' <<EOF
$open_requests
EOF
)

  if [ -n "$request" ]; then
    number=$(jq -er .number <<EOF
$request
EOF
)
    ci_failed=$(jq -r '[.labels[].name] | index("ci-failed") != null' <<EOF
$request
EOF
)
    if [ "$ci_failed" != true ]; then
      printf 'Release %s is pending in %s#%s.\n' "$version" "$publish_repo" "$number"
      pending="$pending $version"
      continue
    fi
    # Close the request first: if that fails, the branch and the request
    # still agree, and the run fails instead of leaving a request behind.
    gh issue close "$number" -R "$publish_repo" --comment "Superseded: CI failed on \`$branch\`. [This Release run]($run_url) deleted the branch and is preparing a new release from $head." </dev/null
    printf '::notice::Closed %s#%s: CI failed on %s.\n' "$publish_repo" "$number" "$branch"
  else
    closed=$(gh issue list -R "$publish_repo" --state closed --search "\"$title\" in:title" --json number,title </dev/null)
    closed_number=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | first | .number // empty' <<EOF
$closed
EOF
)
    if [ -z "$closed_number" ]; then
      printf '::error::%s exists, but %s has no publish request titled "%s". Check it by hand.\n' "$branch" "$publish_repo" "$title"
      exit 1
    fi
    printf '::notice::%s#%s is closed but %s was never published.\n' "$publish_repo" "$closed_number" "$branch"
  fi

  # The lease makes the push fail instead of deleting the branch if it moved.
  git push --force-with-lease="$ref:$sha" "$remote" ":$ref" </dev/null
  printf '::notice::Deleted stale release branch %s (%s).\n' "$branch" "$sha"
done <<EOF
$branches
EOF

if [ "$RELEASE_TRIGGER" = workflow_run ] && [ -n "$pending" ]; then
  # Craft would refuse with "release branch already exists". Merging the
  # pending release into main triggers Build and then Release again, and that
  # run releases this commit.
  printf '::notice::Release%s is still pending. The Release run after its merge into main will release %s.\n' "$pending" "$head"
  printf 'proceed=false\n' >>"$GITHUB_OUTPUT"
  exit 0
fi

printf 'proceed=true\n' >>"$GITHUB_OUTPUT"
