#!/usr/bin/env bash
# Development CLI only. Never run user chat messages as coding-agent prompts.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if ! command -v agy >/dev/null 2>&1; then
  echo 'Antigravity CLI (agy) is not installed. See README.md.' >&2
  exit 127
fi
exec agy --model "${ANTIGRAVITY_MODEL:-gemini-3.8-flash-medium}" "$@"
