#!/bin/bash

# Low-level helper that downloads a registry skill into an explicit target root.
# Normal agent turns should prefer the built-in install_skill_from_registry tool.
# Usage: ./install-skill.sh <owner/repo@skill-name> <target-root> [skill-name]

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <owner/repo@skill-name> <target-root> [skill-name]"
  echo "Example: $0 vercel-labs/agent-skills@vercel-react-best-practices /tmp/skills"
  exit 1
fi

FULL_SKILL_NAME="$1"
TARGET_ROOT="$2"
SKILL_NAME="${3:-${FULL_SKILL_NAME##*@}}"

if [[ -z "$SKILL_NAME" || "$SKILL_NAME" == "$FULL_SKILL_NAME" ]]; then
  echo "Error: Invalid skill format. Expected: owner/repo@skill-name"
  exit 1
fi

mkdir -p "$TARGET_ROOT"

if [[ ! -d "$TARGET_ROOT" ]]; then
  echo "Error: Could not create target root: $TARGET_ROOT"
  exit 1
fi

TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT

SKILL_SOURCE="$TMP_HOME/.agents/skills/$SKILL_NAME"
SKILL_TARGET="$TARGET_ROOT/$SKILL_NAME"

HOME="$TMP_HOME" npx skills add "$FULL_SKILL_NAME" --yes --global > /dev/null 2>&1

if [[ ! -d "$SKILL_SOURCE" ]]; then
  echo "Skill '$SKILL_NAME' installation failed"
  exit 1
fi

if [[ -e "$SKILL_TARGET" ]]; then
  echo "Error: Target already exists: $SKILL_TARGET"
  exit 1
fi

cp -R "$SKILL_SOURCE" "$SKILL_TARGET"

echo "Skill '$SKILL_NAME' installed successfully to $SKILL_TARGET"
