#!/usr/bin/env bash
# Source this file for Vertex AI / Antigravity ADC settings.
companion_project_file="${COMPANION_PROJECT_FILE:-$HOME/project_id.txt}"
if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  if [[ ! -r "$companion_project_file" ]]; then
    echo 'Set GOOGLE_CLOUD_PROJECT or run bash init.sh first.' >&2
    return 1
  fi
  GOOGLE_CLOUD_PROJECT=$(<"$companion_project_file")
  if [[ -z "$GOOGLE_CLOUD_PROJECT" ]]; then
    echo "Project ID is empty: $companion_project_file" >&2
    return 1
  fi
fi
export GOOGLE_CLOUD_PROJECT
export PROJECT_ID="$GOOGLE_CLOUD_PROJECT"
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-global}"
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
export GEMINI_TTS_MODEL="${GEMINI_TTS_MODEL:-gemini-3.8-flash-tts}"
export AGY_ADC_AUTH=true
# Credentials come from ADC / attached service account / Workload Identity.
# This script does not change gcloud profiles or invoke interactive login.

unset companion_project_file
