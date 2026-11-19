#!/usr/bin/env bash
# Netlify's convention: 0 skips the build; 1 continues the normal deploy.
# Only skip when Git positively establishes that website inputs are unchanged.

deploy() {
  echo "Netlify: deploy ($1)."
  exit 1
}

previous=${CACHED_COMMIT_REF:-}
current=${COMMIT_REF:-}

# Netlify supplies full commit hashes. Reject empty/malformed refs before Git.
[[ $previous =~ ^[0-9a-fA-F]{40}$ && $current =~ ^[0-9a-fA-F]{40}$ ]] \
  || deploy 'missing or invalid commit references'

root=$(git rev-parse --show-toplevel 2>/dev/null) || deploy 'not a Git checkout'
cd "$root" || deploy 'cannot access repository root'
previous=$(git rev-parse --verify "${previous}^{commit}" 2>/dev/null) \
  || deploy 'previous commit unavailable'
current=$(git rev-parse --verify "${current}^{commit}" 2>/dev/null) \
  || deploy 'current commit unavailable'

# Without cache Netlify can set both refs to the current commit. Also permits
# explicit retries of the same commit to run normal build/post-processing.
[[ $previous != "$current" ]] || deploy 'identical refs or cache reset'
head=$(git rev-parse --verify HEAD 2>/dev/null) || deploy 'HEAD unavailable'
[[ $head == "$current" ]] || deploy 'checkout does not match current commit'
git merge-base --is-ancestor "$previous" "$current" \
  || deploy 'history is incomplete or has diverged'

# Compare against the last built commit, not HEAD^, to include multi-commit
# pushes and changes since skipped builds. Disabling renames covers both sides
# of moves into/out of website/. Root-anchored paths also work from subfolders.
git diff --quiet --no-ext-diff --no-textconv --no-renames "$previous" "$current" -- \
  ':(top)website' ':(top)netlify.toml' ':(top)scripts/netlify-ignore.sh'
result=$?
case $result in
  0) echo 'Netlify: skip (website and deployment configuration unchanged).'; exit 0 ;;
  1) deploy 'website or deployment configuration changed' ;;
  *) deploy 'Git diff failed' ;;
esac
