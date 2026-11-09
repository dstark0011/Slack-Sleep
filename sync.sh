#!/usr/bin/env bash
# Nightly pipeline: pull data, build features, rebuild the single-file app.
set -euo pipefail
cd "$(dirname "$0")"
python sync/garmin_sync.py "$@"
python sync/hevy_sync.py
python sync/build_features.py
python scripts/build_dist.py
