#!/usr/bin/env bash
#
# install.sh — register this repository's skills with a DeepSeek Harness
#               skill root by creating per-skill symlinks.
#
# DSH's filesystem skill provider scans, in precedence order:
#   <projectRoot>/.dsh/skills   <projectRoot>/.agents/skills
#   customSkillDirs             ~/.dsh/skills   ~/.agents/skills
# This repository's top-level skills/ directory is none of those, so a bare
# clone registers nothing. This script links each skill in.
#
# Usage:
#   ./install.sh                          # all skills -> ~/.dsh/skills (user scope)
#   ./install.sh --project /path/to/repo  # all skills -> <repo>/.dsh/skills
#   ./install.sh ghost-theme-development  # only the named skills
#   ./install.sh --uninstall              # remove the links it would create
#   ./install.sh --dry-run
#
# Options:
#   --project DIR   Install into DIR/.dsh/skills instead of ~/.dsh/skills.
#   --target DIR    Install into DIR itself (escape hatch; wins over --project).
#   --uninstall     Remove managed links instead of creating them.
#   --dry-run       Print what would happen; change nothing.
#   -h, --help      Show this help.
#
# Only symlinks pointing into this repository are ever removed, so unrelated
# skills in the target root are left untouched.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
skills_dir="$script_dir/skills"

target=""
project=""
uninstall=0
dry_run=0
declare -a requested=()

die() { printf 'install.sh: %s\n' "$1" >&2; exit 1; }
info() { printf '  %s\n' "$1"; }
run() {
  if [ "$dry_run" -eq 1 ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

usage() { sed -n '3,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)   [ "$#" -ge 2 ] || die "--project needs a directory"; project="$2"; shift 2 ;;
    --target)    [ "$#" -ge 2 ] || die "--target needs a directory";  target="$2";  shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    --dry-run)   dry_run=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    -*)          die "unknown option: $1 (try --help)" ;;
    *)           requested+=("$1"); shift ;;
  esac
done

[ -d "$skills_dir" ] || die "no skills/ directory next to this script"

# Resolve discovered skills: top-level dirs containing SKILL.md, plus flat
# top-level *.md files with frontmatter. Mirrors dsh-skill-filesystem.
declare -a available=()
for entry in "$skills_dir"/*; do
  [ -e "$entry" ] || continue
  base="$(basename -- "$entry")"
  case "$base" in .*|_*) continue ;; esac
  if [ -d "$entry" ]; then
    [ -f "$entry/SKILL.md" ] || continue
    available+=("$base")
  elif [ -f "$entry" ] && [ "${base##*.}" = "md" ]; then
    available+=("$base")
  fi
done

[ "${#available[@]}" -gt 0 ] || die "no skills found under $skills_dir"

# Resolve the selection.
declare -a selected=()
if [ "${#requested[@]}" -eq 0 ]; then
  selected=("${available[@]}")
else
  for want in "${requested[@]}"; do
    found=0
    for have in "${available[@]}"; do
      [ "$have" = "$want" ] && { found=1; break; }
    done
    [ "$found" -eq 1 ] || die "unknown skill: $want (available: ${available[*]})"
    selected+=("$want")
  done
fi

# Resolve the destination root.
if [ -n "$target" ]; then
  dest="$target"
elif [ -n "$project" ]; then
  [ -d "$project" ] || die "--project directory does not exist: $project"
  [ -d "$project/.git" ] || printf 'install.sh: warning: %s has no .git; project-root discovery may not apply\n' "$project" >&2
  dest="$project/.dsh/skills"
else
  dest="${DSH_HOME:-$HOME/.dsh}/skills"
fi

action="link into"; [ "$uninstall" -eq 1 ] && action="unlink from"
printf 'install.sh: %s %s\n' "$action" "$dest"
printf '  skills: %s\n' "${selected[*]}"

[ "$dry_run" -eq 1 ] || mkdir -p "$dest"

removed=0
linked=0
skipped=0

for name in "${selected[@]}"; do
  src="$skills_dir/$name"
  dst="$dest/$name"

  if [ "$uninstall" -eq 1 ]; then
    if [ -L "$dst" ]; then
      current="$(readlink -- "$dst" || true)"
      case "$current" in
        "$script_dir"/*) run rm -- "$dst"; removed=$((removed + 1)) ;;
        *) info "skip (not managed by this repo): $dst -> $current"; skipped=$((skipped + 1)) ;;
      esac
    else
      info "skip (not a symlink): $dst"; skipped=$((skipped + 1))
    fi
    continue
  fi

  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    info "skip (real file/directory exists): $dst"; skipped=$((skipped + 1))
    continue
  fi
  if [ -L "$dst" ] && [ "$(readlink -- "$dst")" = "$src" ]; then
    info "ok (already linked): $dst"; skipped=$((skipped + 1))
    continue
  fi
  run ln -sfn -- "$src" "$dst"
  linked=$((linked + 1))
done

if [ "$uninstall" -eq 1 ]; then
  printf 'install.sh: removed %d, skipped %d\n' "$removed" "$skipped"
else
  printf 'install.sh: linked %d, skipped %d\n' "$linked" "$skipped"
  printf 'install.sh: restart DSH if it is already running, then check the skill catalog.\n'
fi
