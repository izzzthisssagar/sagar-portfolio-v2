#!/usr/bin/env node
// Deployment smoke test: a reusable, read-only check against a running web+API deployment
// (staging or production). Never mutates data — every check is a GET against public or
// unauthenticated-safe endpoints. See docs/deployment.md.
//
//   pnpm smoke:deployment -- --base-url=https://example.com --api-base-url=https://api.example.com
//
// Flags:
//   --base-url          web origin to check (required)
//   --api-base-url      API origin to check (defaults to --base-url, since production commonly
//                        proxies /api/v1 through the same origin)
//   --project-slug      a known-published project slug to spot-check (default: qa-mastery)
//   --timeout           per-request timeout in ms (default: 8000)
//   --json              emit a single JSON report to stdout instead of human-readable lines
//
// Exit code is non-zero if any check fails.

function parseArgs(argv) {
  const args = { timeout: 8000, projectSlug: 'qa-mastery', json: false };
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    switch (key) {
      case 'base-url':
        args.baseUrl = value;
        break;
      case 'api-base-url':
        args.apiBaseUrl = value;
        break;
      case 'project-slug':
        args.projectSlug = value;
        break;
      case 'timeout':
        args.timeout = Number(value);
        break;
      case 'json':
        args.json = true;
        break;
    }
  }
  return args;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, { ...opts, signal: controller.signal });
    return { response, durationMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function check(results, name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, durationMs: Date.now() - start, detail: detail ?? null });
  } catch (err) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function expectStatus(response, expected) {
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  if (!ok) {
    throw new Error(`expected status ${expected}, got ${response.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    console.error('Usage: deployment-smoke.mjs --base-url=<url> [--api-base-url=<url>] [--json]');
    process.exit(2);
  }
  const webBase = args.baseUrl.replace(/\/$/, '');
  const apiBase = (args.apiBaseUrl ?? args.baseUrl).replace(/\/$/, '');
  const requestId = `smoke-${Math.random().toString(36).slice(2, 10)}`;
  const results = [];

  // ---- Public web pages ------------------------------------------------------------------
  await check(results, 'web: homepage 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: /about 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/about`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: /work index 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/work`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, `web: /work/${args.projectSlug} 200`, async () => {
    const { response } = await fetchWithTimeout(`${webBase}/work/${args.projectSlug}`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: /notes index 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/notes`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: /contact 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/contact`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: /sitemap.xml 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/sitemap.xml`, {}, args.timeout);
    expectStatus(response, 200);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('xml')) throw new Error(`expected xml content-type, got "${contentType}"`);
  });
  await check(results, 'web: /robots.txt 200', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/robots.txt`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'web: security headers present on homepage', async () => {
    const { response } = await fetchWithTimeout(`${webBase}/`, {}, args.timeout);
    const required = ['x-content-type-options', 'referrer-policy'];
    const missing = required.filter((h) => !response.headers.get(h));
    if (missing.length) throw new Error(`missing headers: ${missing.join(', ')}`);
    return { headers: Object.fromEntries(required.map((h) => [h, response.headers.get(h)])) };
  });

  // ---- API -------------------------------------------------------------------------------
  await check(results, 'api: liveness 200', async () => {
    const { response } = await fetchWithTimeout(`${apiBase}/api/v1/health/live`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'api: readiness reports ok', async () => {
    const { response } = await fetchWithTimeout(`${apiBase}/api/v1/health/ready`, {}, args.timeout);
    const body = await response.json();
    if (body?.ok !== true) throw new Error(`readiness not ok: ${JSON.stringify(body)}`);
    return body;
  });
  await check(results, 'api: public project list responds', async () => {
    const { response } = await fetchWithTimeout(`${apiBase}/api/v1/projects?page=1&limit=10`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'api: public post list responds', async () => {
    const { response } = await fetchWithTimeout(`${apiBase}/api/v1/posts?page=1&limit=10`, {}, args.timeout);
    expectStatus(response, 200);
  });
  await check(results, 'api: unknown media id returns 404 with a safe envelope', async () => {
    const { response } = await fetchWithTimeout(
      `${apiBase}/api/v1/media/00000000-0000-0000-0000-000000000000/file`,
      {},
      args.timeout,
    );
    expectStatus(response, 404);
    const body = await response.json().catch(() => null);
    if (!body?.error || typeof body.error.requestId !== 'string') {
      throw new Error(`expected a { error: { requestId } } envelope, got: ${JSON.stringify(body)}`);
    }
    if (JSON.stringify(body).match(/postgres|prisma|stack|at\s+\w+\.\w+\s+\(/i)) {
      throw new Error('error envelope looks like it leaked internal detail');
    }
  });
  await check(results, 'api: caller-supplied request id is echoed', async () => {
    const { response } = await fetchWithTimeout(
      `${apiBase}/api/v1/health/live`,
      { headers: { 'x-request-id': requestId } },
      args.timeout,
    );
    if (response.headers.get('x-request-id') !== requestId) {
      throw new Error('request id was not echoed back');
    }
  });

  const failed = results.filter((r) => !r.ok);
  const report = {
    baseUrl: webBase,
    apiBaseUrl: apiBase,
    requestId,
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const r of results) {
      const status = r.ok ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${r.name} (${r.durationMs}ms)${r.ok ? '' : ` — ${r.error}`}`);
    }
    console.log(`\n${report.passed}/${report.total} checks passed.`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
