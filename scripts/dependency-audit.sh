#!/usr/bin/env bash
# Thin wrapper around `pnpm audit` (workspace-aware — pnpm audits the whole workspace's resolved
# dependency graph from the single root pnpm-lock.yaml) that produces a clear pass/fail signal.
#
# Policy: fail (non-zero exit) only on high/critical advisories. Moderate/low findings are
# printed for visibility but do not fail the build — this matches what CI already runs
# (.github/workflows/ci.yml: `pnpm audit --audit-level high`), documented in
# docs/security-production.md rather than re-implemented differently here.
#
# Usage: pnpm dependency-audit
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "== dependency-audit: pnpm audit --audit-level high (workspace-wide) =="
pnpm audit --audit-level high
HIGH_STATUS=$?

echo
echo "== dependency-audit: full report (all severities, informational) =="
pnpm audit
FULL_STATUS=$?
# pnpm audit exits non-zero whenever *any* vulnerability is found, even moderate/low, so
# FULL_STATUS alone isn't a useful pass/fail signal here — only HIGH_STATUS (from the
# --audit-level high run above) is.

echo
if [ "$HIGH_STATUS" -eq 0 ]; then
  echo "== dependency-audit: PASS — no high/critical severity vulnerabilities =="
  exit 0
else
  echo "== dependency-audit: FAIL — high/critical severity vulnerabilities found (see above) =="
  exit "$HIGH_STATUS"
fi
