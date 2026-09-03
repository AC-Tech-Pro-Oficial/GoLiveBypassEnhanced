#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node tests/test-enhanced-rtc-recovery.cjs
