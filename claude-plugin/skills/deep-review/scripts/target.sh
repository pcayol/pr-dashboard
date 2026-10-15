#!/usr/bin/env bash
# Resolves the review target and prints the base ref, the commits and the changed files.
# Usage: target.sh              -> current branch against its base
#        target.sh <pr-number>  -> that PR (no checkout, no branch switch)
set -uo pipefail

pr="${1:-}"
repo_arg=()
[ -n "${2:-}" ] && repo_arg=(--repo "$2")

default_base() {
  git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null \
    || echo "origin/$(gh repo view "${repo_arg[@]}" --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null || echo develop)"
}

if [ -n "$pr" ]; then
  echo "## PR"
  gh pr view "$pr" "${repo_arg[@]}" \
    --json number,title,url,author,baseRefName,headRefName,isDraft,additions,deletions,changedFiles,body \
    --template '{{.number}} · {{.title}}
{{.url}}
author: {{.author.login}}  draft: {{.isDraft}}
base: {{.baseRefName}}  head: {{.headRefName}}
+{{.additions}} -{{.deletions}} in {{.changedFiles}} files

--- description ---
{{.body}}
'
  base="origin/$(gh pr view "$pr" "${repo_arg[@]}" --json baseRefName --jq .baseRefName)"
  head="refs/pull/$pr/head"
  git fetch --quiet origin "+pull/$pr/head:$head" "$(basename "$base")" 2>/dev/null \
    || git fetch --quiet origin "+pull/$pr/head:$head" 2>/dev/null
  echo
  echo "## CI"
  gh pr checks "$pr" "${repo_arg[@]}" 2>&1 | head -30
else
  base="$(default_base)"
  head="HEAD"
  echo "## Local branch"
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "status: $(git status --porcelain | wc -l | tr -d ' ') modified files in the working tree"
fi

echo
echo "## Base"
echo "base ref: $base"
echo "merge-base: $(git merge-base "$base" "$head" 2>/dev/null)"
echo
echo "## Commits ($base..$head)"
git log --format='%h %ad %s' --date=short "$base..$head"
echo
echo "## Changed files"
git diff --stat "$base...$head"
echo
echo "Read the diff with:  git diff $base...$head"
echo "Read a file's base version with:  git show $base:<path>"
