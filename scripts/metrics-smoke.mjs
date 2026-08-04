#!/usr/bin/env node
// Metrics endpoint smoke test: proves GET /api/v1/internal/metrics is actually wired correctly
// end to end against a running API — disabled/unauthenticated access is refused, the configured
// token works, and the response looks like real Prometheus exposition with no obvious secret
// leakage. Never used against production with a real token from a shell history; CI and staging
// both use a disposable, CI-only METRICS_TOKEN. See docs/operations.md.
//
//   pnpm metrics:smoke -- --api-base-url=http://127.0.0.1:4000 --token=<METRICS_TOKEN>
//
// Exit code is non-zero if any check fails.

function parseArgs(argv) {
  const args = { timeout: 8000 };
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    if (key === 'api-base-url') args.apiBaseUrl = value;
    else if (key === 'token') args.token = value;
    else if (key === 'timeout') args.timeout = Number(value);
  }
  return args;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token ?? process.env.METRICS_TOKEN;
  if (!args.apiBaseUrl || !token) {
    console.error(
      'Usage: metrics-smoke.mjs --api-base-url=<url> --token=<METRICS_TOKEN> (or set METRICS_TOKEN)',
    );
    process.exit(2);
  }
  const apiBase = args.apiBaseUrl.replace(/\/$/, '');
  const url = `${apiBase}/api/v1/internal/metrics`;
  const results = [];

  await check(results, 'metrics: no token returns 404 (never 401/403)', async () => {
    const response = await fetchWithTimeout(url, {}, args.timeout);
    if (response.status !== 404) throw new Error(`expected 404, got ${response.status}`);
  });

  await check(results, 'metrics: wrong token returns 404', async () => {
    const response = await fetchWithTimeout(
      url,
      { headers: { 'x-metrics-token': 'definitely-the-wrong-token' } },
      args.timeout,
    );
    if (response.status !== 404) throw new Error(`expected 404, got ${response.status}`);
  });

  let body = '';
  await check(
    results,
    'metrics: correct token returns 200 with Prometheus content type',
    async () => {
      const response = await fetchWithTimeout(
        url,
        { headers: { 'x-metrics-token': token } },
        args.timeout,
      );
      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/plain')) {
        throw new Error(`expected text/plain content-type, got "${contentType}"`);
      }
      body = await response.text();
    },
  );

  await check(results, 'metrics: response contains the expected metric families', () => {
    const expected = [
      'process_uptime_seconds',
      'http_requests_total',
      'http_request_duration_seconds',
      'readiness_status',
      'auth_failures_total',
      'rate_limit_rejections_total',
      'media_transition_failures_total',
      'contact_notification_total',
      'database_failures_total',
    ];
    const missing = expected.filter((name) => !body.includes(name));
    if (missing.length) throw new Error(`missing metric families: ${missing.join(', ')}`);
  });

  await check(
    results,
    'metrics: response never echoes the token or obvious secret patterns',
    () => {
      if (body.includes(token)) throw new Error('response body contains the metrics token itself');
      const suspicious = body.match(
        /email|password|cookie|access.?token|refresh.?token|@\w+\.\w+/i,
      );
      if (suspicious)
        throw new Error(`response body looks like it leaked PII/secrets: "${suspicious[0]}"`);
    },
  );

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${r.name} (${r.durationMs}ms)${r.ok ? '' : ` — ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('metrics smoke test crashed:', err);
  process.exit(1);
});
