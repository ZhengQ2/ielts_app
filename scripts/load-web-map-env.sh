#!/usr/bin/env bash

# Load the browser-only Google Maps configuration without writing credentials
# to the repository. Explicit environment variables always win (as they do in
# GitHub Actions); local AWS builds and development fall back to Parameter Store.
load_web_map_env() {
  local parameter_region="${1:-${AWS_REGION:-us-east-1}}"
  local api_key_parameter="${WEB_MAP_API_KEY_PARAMETER:-/ielts-map/build/NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}"
  local map_id_parameter="${WEB_MAP_ID_PARAMETER:-/ielts-map/build/NEXT_PUBLIC_GOOGLE_MAP_ID}"

  if [[ -z "${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}" ]]; then
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$(
      aws ssm get-parameter \
        --region "$parameter_region" \
        --name "$api_key_parameter" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text
    )"
  fi

  if [[ -z "${NEXT_PUBLIC_GOOGLE_MAP_ID:-}" ]]; then
    NEXT_PUBLIC_GOOGLE_MAP_ID="$(
      aws ssm get-parameter \
        --region "$parameter_region" \
        --name "$map_id_parameter" \
        --query 'Parameter.Value' \
        --output text
    )"
  fi

  if [[ -z "${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}" || "${#NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}" -lt 20 ]]; then
    echo "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing or invalid; refusing to build a map-less site." >&2
    return 1
  fi

  if [[ -z "${NEXT_PUBLIC_GOOGLE_MAP_ID:-}" || "${#NEXT_PUBLIC_GOOGLE_MAP_ID}" -lt 8 ]]; then
    echo "NEXT_PUBLIC_GOOGLE_MAP_ID is missing or invalid; refusing to build a map-less site." >&2
    return 1
  fi

  export NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  export NEXT_PUBLIC_GOOGLE_MAP_ID
}
