#!/bin/sh
# Typecheck plus the full test suite in one pass.
#
# The shell here has historically mangled long multi-command invocations with
# CJK paths and quoted patterns, so this wrapper keeps the pipeline in a file
# where the quoting is stable. Results land in /tmp/piweb-verify.log.
cd "$(dirname "$0")/.." || exit 1
{
  echo "=== tsc ==="
  npx tsc --noEmit
  echo "tsc exit: $?"
  echo "=== tests ==="
  npm test 2>&1 | grep -E "^(not ok|# (tests|pass|fail|cancelled))"
} > /tmp/piweb-verify.log 2>&1
echo "verify written to /tmp/piweb-verify.log"
