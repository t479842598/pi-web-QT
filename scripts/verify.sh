#!/bin/sh
# Typecheck plus the full test suite in one pass.
#
# The shell here has historically mangled long multi-command invocations with
# CJK paths and quoted patterns, so this wrapper keeps the pipeline in a file
# where the quoting is stable. Results land in /tmp/piweb-verify.log.
#
# Exit status reflects real verification, not the last pipeline element: node's
# test runner exits non-zero for a skipped todo as well as a failure, and grep
# would mask either one, so the summary is re-read from the log instead.
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/piweb-verify.log
{
  echo "=== tsc ==="
  if npx tsc --noEmit; then
    echo "tsc exit: 0"
  else
    echo "tsc exit: 1"
  fi
  echo "=== tests ==="
  npm test > /tmp/piweb-test-raw.log 2>&1
  echo "npm test exit: $?"
  grep -E "^(not ok|# (tests|pass|fail|cancelled|skipped))" /tmp/piweb-test-raw.log
  # A real failure is a `not ok` line; node also exits non-zero for a skipped
  # test, which is not a failure.
  if grep -q "^not ok" /tmp/piweb-test-raw.log; then
    echo "verify: FAIL (see the not ok lines above)"
    exit 1
  fi
  if grep -qE "^# fail [1-9]" /tmp/piweb-test-raw.log; then
    echo "verify: FAIL"
    exit 1
  fi
  echo "verify: OK"
} > "$LOG" 2>&1
rc=$?
echo "verify written to $LOG"
exit $rc
