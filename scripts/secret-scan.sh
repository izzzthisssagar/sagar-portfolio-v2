#!/usr/bin/env bash
# Scans this repository's *tracked git content* (committed history, not just the working tree)
# for accidentally committed secrets.
#
# Preferred path: gitleaks (https://github.com/gitleaks/gitleaks), a real, actively maintained
# secret-scanning tool, run entirely locally against `.git` — nothing is uploaded anywhere.
# Fallback path: a small regex-based scanner over `git ls-files`/`git grep`, used only when
# gitleaks isn't available in this environment. The fallback is a baseline safety net, not a
# replacement for a dedicated tool — see docs/security-production.md.
#
# Usage: pnpm secret-scan
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$REPORT_DIR"' EXIT

if command -v gitleaks >/dev/null 2>&1; then
  echo "== secret-scan: using gitleaks $(gitleaks version 2>/dev/null | tail -1) =="
  echo "== scanning full tracked git history (git log), not just the working tree =="

  REPORT_JSON="$REPORT_DIR/gitleaks-report.json"

  # --redact: never print the actual secret value to stdout/logs, only its location and rule.
  # exit-code 0 here so we can inspect the result ourselves and print a clear summary either way;
  # the script's own final `exit` reflects pass/fail for CI.
  set +e
  gitleaks git \
    --redact \
    --no-banner \
    --report-format json \
    --report-path "$REPORT_JSON" \
    --exit-code 0 \
    .
  GITLEAKS_STATUS=$?
  set -e

  if [ "$GITLEAKS_STATUS" -ne 0 ]; then
    echo "gitleaks itself failed to run (exit $GITLEAKS_STATUS) — treating as a scan failure." >&2
    exit 2
  fi

  FINDING_COUNT="$(node -e '
    const fs = require("fs");
    const path = process.argv[1];
    let data = [];
    try {
      const raw = fs.readFileSync(path, "utf8").trim();
      if (raw.length) data = JSON.parse(raw);
    } catch (err) {
      console.error("Failed to parse gitleaks report:", err.message);
      process.exit(2);
    }
    console.log(Array.isArray(data) ? data.length : 0);
  ' "$REPORT_JSON")"

  if [ "$FINDING_COUNT" -eq 0 ]; then
    echo "== secret-scan: PASS — gitleaks found 0 potential secrets in tracked git history =="
    exit 0
  fi

  echo "== secret-scan: FAIL — gitleaks found $FINDING_COUNT potential secret(s) =="
  echo "Locations only (values redacted). Full report: $REPORT_JSON (deleted when this shell exits — rerun with --report-path to keep it)."
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const f of data) {
      console.log(`- [${f.RuleID}] ${f.File}:${f.StartLine} (commit ${String(f.Commit).slice(0, 12)})`);
    }
  ' "$REPORT_JSON"
  exit 1
fi

echo "== secret-scan: gitleaks not found on PATH — falling back to a baseline regex scanner =="
echo "== This fallback is NOT a replacement for a dedicated tool like gitleaks/trufflehog. =="
echo "== scanning tracked files only (git ls-files), via git grep =="

# Baseline patterns. Intentionally conservative/common — see docs/security-production.md for
# the documented limitation that this is not a substitute for a maintained scanner.
declare -a PATTERNS=(
  'AKIA[0-9A-Z]{16}'                                        # AWS access key id
  '-----BEGIN[A-Z ]*PRIVATE KEY-----'                        # PEM private key header
  '(api|apikey|api_key|secret|token)["'\'' ]*[:=][^,;\n]{0,3}["'\''][A-Za-z0-9_\-]{20,}["'\'']' # generic API-key-shaped string
  '[Aa]uthorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9_\-\.]{20,}'  # bearer tokens
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'         # JWT-shaped string
  '(postgres|postgresql|mysql|mongodb)://[^:space]+:[^@[:space:]]+@'      # connection string with inline password
)

FOUND=0
for pattern in "${PATTERNS[@]}"; do
  # -I: skip binary files, -n: line numbers, -E: extended regex, over tracked files only.
  if matches=$(git grep -I -n -E "$pattern" -- . ':!pnpm-lock.yaml' ':!scripts/secret-scan.sh' 2>/dev/null); then
    if [ -n "$matches" ]; then
      FOUND=1
      echo "-- pattern matched: $pattern --"
      # Print file:line only, not the full matched line, to avoid echoing a real secret value
      # in normal script output.
      echo "$matches" | cut -d: -f1,2 | sed 's/^/  /'
    fi
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "== secret-scan: PASS — baseline regex scan found no matches in tracked files =="
  exit 0
else
  echo "== secret-scan: FAIL — baseline regex scan found potential secret-shaped matches above =="
  echo "== Review each file:line manually; this scanner has no allowlisting/entropy checks and can false-positive. =="
  exit 1
fi
