#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=load-web-map-env.sh
source "${project_root}/scripts/load-web-map-env.sh"
load_web_map_env

cd "$project_root"
exec npm run dev --workspace @ielts-map/web
