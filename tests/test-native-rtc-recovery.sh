#!/bin/sh
set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
node "$REPO/tests/test-native-rtc-recovery.cjs"
