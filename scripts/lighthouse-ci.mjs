#!/usr/bin/env node
// Real Lighthouse CI gate — a real production build, a real seeded database, the actual
// `output: 'standalone'` production server (never `next dev`), audited page by page against the
// budgets documented in docs/performance-release-gates.md. Fails the process (non-zero exit) on
// any regression. See that doc for the full methodology and rationale behind each budget.
//
//   pnpm lighthouse:ci
//
// Requires a reachable, already-seeded API at API_URL (this script never starts one itself — CI
// starts the API once, ahead of the production build, and reuses that same process here; see
// .github/workflows/ci.yml). Writes machine-readable JSON (one full Lighthouse report per page,
// plus a summary) to LIGHTHOUSE_OUTPUT_DIR (default: lighthouse-results/) for artifact upload.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STANDALONE_DIR = path.join(REPO_ROOT, 'apps/web/.next/standalone');
const STANDALONE_SERVER = path.join(STANDALONE_DIR, 'apps/web/server.js');
const OUTPUT_DIR = process.env.LIGHTHOUSE_OUTPUT_DIR ?? path.join(REPO_ROOT, 'lighthouse-results');

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
const WEB_URL = process.env.PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000';

/** Reuses the exact same Chromium `pnpm exec playwright install --with-deps chromium` already
 * installs for the e2e suite (see .github/workflows/ci.yml) — no second browser download, and no
 * assumption that the CI runner happens to ship its own system Chrome. Falls through to
 * `CHROME_PATH` (an explicit override) first, then chrome-launcher's own system-Chrome discovery
 * as a last resort for environments that have neither. */
async function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const { chromium } = await import('@playwright/test');
    const execPath = chromium.executablePath();
    if (execPath && existsSync(execPath)) return execPath;
  } catch {
    // @playwright/test not installed/resolvable, or no browser downloaded yet — fall through.
  }
  return undefined;
}
const WEB_PORT = new URL(WEB_URL).port || '3000';

const PAGES = [
  { path: '/', name: 'homepage', isHomepage: true },
  { path: '/about', name: 'about' },
  { path: '/work', name: 'work' },
  { path: '/work/qa-mastery', name: 'work-qa-mastery' },
  { path: '/notes', name: 'notes' },
  { path: '/contact', name: 'contact' },
];

// docs/performance-release-gates.md's "Non-regression budgets" table — keep these in sync with
// that doc; it's the source of truth for *why* each number is what it is.
const BUDGETS = {
  performance: 90,
  accessibility: 100,
  bestPractices: 90,
  seo: 100,
  clsMax: 0.1,
  lcpMaxMs: 3000,
  jsTransferMaxHomepageBytes: 500 * 1024,
  jsTransferMaxOtherBytes: 250 * 1024,
  totalTransferMaxBytes: 600 * 1024,
};

function log(msg) {
  console.log(`[lighthouse-ci] ${msg}`);
}

async function fetchOk(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(url, { attempts = 30, intervalMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (await fetchOk(url)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function ensureProductionBuild() {
  const canSkipBuild =
    existsSync(STANDALONE_SERVER) && process.env.LIGHTHOUSE_SKIP_BUILD === 'true';
  if (canSkipBuild) {
    log('LIGHTHOUSE_SKIP_BUILD=true and a standalone build already exists — reusing it.');
  } else {
    log("Building the web app in production mode (never next dev — see the doc's Methodology).");
    await run('pnpm', ['--filter', '@portfolio/web', 'build'], {
      env: {
        ...process.env,
        API_URL,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? `${API_URL}/api/v1`,
        PUBLIC_SITE_URL: WEB_URL,
        ALLOW_STATIC_CONTENT_FALLBACK: 'false',
      },
    });
  }
  // The standalone server doesn't bundle its own static assets or public/ directory — Next's own
  // documented deployment step, not something specific to this repo (docs/performance-release-
  // gates.md's Methodology). Always redone, even when the build itself was skipped/reused: a
  // build produced earlier in the same CI job (see LIGHTHOUSE_SKIP_BUILD in
  // .github/workflows/ci.yml) built `.next/standalone` but never ran this copy step, since
  // nothing else in that job serves the standalone build directly. Idempotent either way.
  await cp(
    path.join(REPO_ROOT, 'apps/web/.next/static'),
    path.join(STANDALONE_DIR, 'apps/web/.next/static'),
    {
      recursive: true,
      force: true,
    },
  );
  await cp(path.join(REPO_ROOT, 'apps/web/public'), path.join(STANDALONE_DIR, 'apps/web/public'), {
    recursive: true,
    force: true,
  });
}

function startStandaloneServer() {
  const child = spawn('node', [STANDALONE_SERVER], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: WEB_PORT,
      API_URL,
      PUBLIC_SITE_URL: WEB_URL,
    },
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d.toString()));
  child.stderr.on('data', (d) => (output += d.toString()));
  return { child, getOutput: () => output };
}

function stopStandaloneServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 5000);
  });
}

function byteSizeOf(lhr, resourceType) {
  const summary = lhr.audits['resource-summary']?.details?.items ?? [];
  const item = summary.find((i) => i.resourceType === resourceType);
  return item?.transferSize ?? 0;
}

function cspBlockedErrors(lhr) {
  const items = lhr.audits['errors-in-console']?.details?.items ?? [];
  return items.filter((item) => {
    const text = `${item.description ?? ''} ${item.source ?? ''}`.toLowerCase();
    return (
      text.includes('content security policy') ||
      text.includes('refused to execute') ||
      text.includes('refused to load') ||
      text.includes('csp')
    );
  });
}

function evaluatePage(page, lhr) {
  const scores = {
    performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
    seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
  };
  const lcpMs = lhr.audits['largest-contentful-paint']?.numericValue ?? Infinity;
  const cls = lhr.audits['cumulative-layout-shift']?.numericValue ?? Infinity;
  const totalTransferBytes = lhr.audits['total-byte-weight']?.numericValue ?? Infinity;
  const jsTransferBytes = byteSizeOf(lhr, 'script');
  const jsBudget = page.isHomepage
    ? BUDGETS.jsTransferMaxHomepageBytes
    : BUDGETS.jsTransferMaxOtherBytes;
  const cspErrors = cspBlockedErrors(lhr);

  const checks = [
    {
      name: 'performance score',
      ok: scores.performance >= BUDGETS.performance,
      actual: scores.performance,
      budget: `>= ${BUDGETS.performance}`,
    },
    {
      name: 'accessibility score',
      ok: scores.accessibility === BUDGETS.accessibility,
      actual: scores.accessibility,
      budget: `= ${BUDGETS.accessibility}`,
    },
    {
      name: 'best practices score',
      ok: scores.bestPractices >= BUDGETS.bestPractices,
      actual: scores.bestPractices,
      budget: `>= ${BUDGETS.bestPractices}`,
    },
    {
      name: 'SEO score',
      ok: scores.seo === BUDGETS.seo,
      actual: scores.seo,
      budget: `= ${BUDGETS.seo}`,
    },
    { name: 'CLS', ok: cls <= BUDGETS.clsMax, actual: cls, budget: `<= ${BUDGETS.clsMax}` },
    {
      name: 'LCP',
      ok: lcpMs <= BUDGETS.lcpMaxMs,
      actual: `${Math.round(lcpMs)}ms`,
      budget: `<= ${BUDGETS.lcpMaxMs}ms`,
    },
    {
      name: 'JS transfer',
      ok: jsTransferBytes <= jsBudget,
      actual: `${Math.round(jsTransferBytes / 1024)}KB`,
      budget: `<= ${Math.round(jsBudget / 1024)}KB`,
    },
    {
      name: 'total transfer',
      ok: totalTransferBytes <= BUDGETS.totalTransferMaxBytes,
      actual: `${Math.round(totalTransferBytes / 1024)}KB`,
      budget: `<= ${Math.round(BUDGETS.totalTransferMaxBytes / 1024)}KB`,
    },
    {
      name: 'CSP-blocked console errors',
      ok: cspErrors.length === 0,
      actual: cspErrors.length,
      budget: '= 0',
    },
  ];

  return {
    page: page.name,
    path: page.path,
    scores,
    lcpMs,
    cls,
    totalTransferBytes,
    jsTransferBytes,
    checks,
  };
}

async function main() {
  log(
    `Verifying the API is already up and reachable at ${API_URL} (this script never starts one).`,
  );
  if (!(await fetchOk(`${API_URL}/api/v1/health/live`))) {
    console.error(
      `[lighthouse-ci] FATAL: ${API_URL}/api/v1/health/live is not reachable. ` +
        'Start the API first (see docs/performance-release-gates.md Methodology / .github/workflows/ci.yml).',
    );
    process.exit(2);
  }

  await ensureProductionBuild();
  await mkdir(OUTPUT_DIR, { recursive: true });

  log(`Starting the standalone production server on port ${WEB_PORT}.`);
  const server = startStandaloneServer();
  let chrome;
  let exitCode = 0;
  try {
    const serverUp = await waitFor(WEB_URL);
    if (!serverUp) {
      console.error(server.getOutput());
      throw new Error(`Standalone server did not become reachable at ${WEB_URL}`);
    }

    chrome = await chromeLauncher.launch({
      chromePath: await resolveChromePath(),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
    });
    log(`Chrome launched on debugging port ${chrome.port}.`);

    const results = [];
    for (const page of PAGES) {
      const url = `${WEB_URL}${page.path}`;
      log(`Auditing ${url} ...`);
      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        logLevel: 'error',
      });
      const lhr = runnerResult.lhr;
      await writeFile(path.join(OUTPUT_DIR, `${page.name}.json`), JSON.stringify(lhr, null, 2));
      results.push(evaluatePage(page, lhr));
    }

    const summary = {
      timestamp: new Date().toISOString(),
      budgets: BUDGETS,
      results: results.map(
        ({ page, path: p, scores, lcpMs, cls, totalTransferBytes, jsTransferBytes, checks }) => ({
          page,
          path: p,
          scores,
          lcpMs: Math.round(lcpMs),
          cls,
          totalTransferKB: Math.round(totalTransferBytes / 1024),
          jsTransferKB: Math.round(jsTransferBytes / 1024),
          allPassed: checks.every((c) => c.ok),
          checks,
        }),
      ),
    };
    summary.allPassed = summary.results.every((r) => r.allPassed);
    await writeFile(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

    for (const result of summary.results) {
      console.log(`\n${result.page} (${result.path})`);
      for (const check of result.checks) {
        console.log(
          `  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}: ${check.actual} (budget ${check.budget})`,
        );
      }
    }
    console.log(
      `\n${summary.results.filter((r) => r.allPassed).length}/${summary.results.length} pages passed every budget.`,
    );
    console.log(`Reports written to ${OUTPUT_DIR}/`);

    exitCode = summary.allPassed ? 0 : 1;
  } finally {
    if (chrome) await chrome.kill();
    log('Shutting down the standalone server.');
    await stopStandaloneServer(server.child);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[lighthouse-ci] crashed:', err);
  process.exit(1);
});
