#!/usr/bin/env bash
# Export the public CheckTest repo (allowlist only) to a directory OUTSIDE this repo.
#
# Allowlist-only on purpose: an unlisted path cannot be exported by construction,
# so there is no denylist to keep in sync.
set -euo pipefail

# Public allowlist (plan task 5).
# Omission is the mechanism: validation/, .opencode/, .engram/, graphify-out/,
# coverage/, dist/, .worktrees/, .cursor/, internal docs (adr/, decisions.md,
# publishing.md, specs, prompts, roadmap) etc. are simply never listed.
# Only user-facing docs ship: limitations + supported-syntax.
# EXCLUDE stays available for a git pathspec exclusion (e.g. ":!docs/adr")
# but defaults to empty.
EXCLUDE=()

ALLOWLIST=(
  "src"
  "tests"
  "bin"
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "jest.config.js"
  "stryker.config.json"
  ".gitignore"
  ".prettierrc"
  ".prettierignore"
  "LICENSE"
  "README.md"
  "docs/limitations.md"
  "docs/supported-syntax.md"
  ".github/workflows/ci.yml"
  "scripts/export-public-repo.sh"
)

usage() {
  echo "usage: $0 -o <out-dir> [--dry-run]" >&2
  echo "  -o, --out   destination directory; must be outside this repo and empty" >&2
  echo "  --dry-run   print the file list, write nothing" >&2
  exit 2
}

out=""
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) [ "$#" -ge 2 ] || usage; out="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
# -o is required for a real export; --dry-run may run without it (prints only).
if [ -z "$out" ] && [ "$dry_run" -ne 1 ]; then
  usage
fi

repo_root="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)"

# An export landing inside the worktree could be swept into a later commit.
# Compare canonical paths: a relative -o (e.g. ./tmp) does not start with the
# repo root as a string, so a lexical check would let it through.
if [ -n "$out" ]; then
  mkdir -p "$out"
  out="$(cd "$out" && pwd -P)"
  case "$out" in
    "$repo_root"|"$repo_root"/*)
      rmdir "$out" 2>/dev/null || true
      echo "refuse: out dir is inside the repo ($repo_root)" >&2
      exit 1
      ;;
  esac
fi

# `git ls-files` only ever lists tracked paths, so an untracked allowlist entry
# would silently drop out of the export. Name it and refuse instead.
untracked=0
for entry in "${ALLOWLIST[@]}"; do
  if [ -z "$(git ls-files -- "$entry")" ]; then
    echo "refuse: allowlisted path is not tracked: $entry" >&2
    untracked=1
  fi
done
[ "$untracked" -eq 0 ] || exit 1

files="$(git ls-files -- "${ALLOWLIST[@]}" ${EXCLUDE[@]+"${EXCLUDE[@]}"} )"
count="$(printf '%s\n' "$files" | wc -l | tr -d ' ')"

if [ "$dry_run" -eq 1 ]; then
  printf '%s\n' "$files"
  echo "# $count files (dry run)" >&2
  exit 0
fi

if [ -n "$(ls -A "$out")" ]; then
  echo "refuse: out dir exists and is not empty: $out" >&2
  exit 1
fi

# Copy the WORKING TREE, not HEAD: `git ls-files` lists paths from the index but
# `tar -C "$repo_root"` reads the actual files on disk, so uncommitted edits to
# tracked allowlisted paths ship. Untracked allowlisted entries are refused above.
git ls-files -z -- "${ALLOWLIST[@]}" ${EXCLUDE[@]+"${EXCLUDE[@]}"} | tar --null -c -T - -C "$repo_root" | tar -x -C "$out"

# The public repo ships a pristine .gitignore: only what a downloader needs.
# The dev repo's .gitignore (validation/ negations, .engram/, .opencode/ etc.)
# is internal and stays out of the allowlist.
if [ -n "$(git ls-files -- public-assets/.gitignore)" ]; then
  cp "$repo_root/public-assets/.gitignore" "$out/.gitignore"
fi

echo "exported $count files -> $out"
