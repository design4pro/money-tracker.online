#!/usr/bin/env bash
# Install the open-mercato `om-*` skill collection into this checkout.
#
#   pnpm install-skills
#
# Skills land in `.agents/skills/` (gitignored, the `skills` CLI's canonical
# project location) and are exposed to Claude Code through one symlink per
# skill under `.claude/skills/om-*` (also gitignored). Repo-local skills live in
# `.ai/skills/` and are committed, together with their `.claude/skills/<name>`
# symlinks - this script never touches them.
#
# Idempotent: a second run refreshes the collection to its latest commit and
# rewrites the same symlinks. Every worktree runs it once, because `.agents/`
# is not part of the repository (`.ai/cezar/workflows/*.yaml` do it in their
# setup step).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOURCE="open-mercato/skills"
SKILLS_DIR=".agents/skills"
CLAUDE_DIR=".claude/skills"

echo "==> installing $SOURCE into $SKILLS_DIR"
npx -y skills add "$SOURCE" --skill '*' --agent universal -y
npx -y skills update -p -y

echo "==> linking $SKILLS_DIR/om-* into $CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR"
# Drop links that no longer resolve (a skill removed upstream) before relinking.
for link in "$CLAUDE_DIR"/om-*; do
  [ -L "$link" ] && [ ! -e "$link" ] && rm "$link"
done
count=0
for skill in "$SKILLS_DIR"/om-*/; do
  name="$(basename "$skill")"
  ln -sfn "../../$SKILLS_DIR/$name" "$CLAUDE_DIR/$name"
  count=$((count + 1))
done
echo "==> $count skills linked"
