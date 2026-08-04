/**
 * A minimal, hand-rolled Prometheus text-exposition (format 0.0.4) registry — no external metrics
 * dependency, since the surface this needs (a handful of counters, one histogram, one gauge, all
 * with small fixed label sets) doesn't justify one. A plain module-level singleton (not a NestJS
 * provider) so both DI-managed code (MetricsController) and the manually-wired HTTP pipeline
 * (configure-app.ts's access-log middleware, shared.ts's ErrorEnvelopeFilter — neither goes
 * through Nest's injector) record against the exact same instance via ordinary module import.
 *
 * Cardinality is bounded by construction, not by convention: every label value accepted here is
 * either a fixed enum (method, status family, transition, notification result) or a route
 * *template* (Express's matched route path, e.g. `/api/v1/projects/:slug` — the literal string
 * with the param placeholder, never the resolved slug/id). `normalizeRoute` maps anything that
 * didn't match a registered route (a 404 on an arbitrary attacker-supplied path) to the single
 * fixed label `unmatched`, so a prober hitting many nonexistent paths can never grow the label
 * set — unlike the structured access log (logging/access-log.middleware.ts), which safely logs
 * the raw path per line without any cardinality concern.
 */

const processStartedAt = process.hrtime.bigint();

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, amount = 1) {
    const key = labelKey(labels);
    const existing = this.values.get(key);
    if (existing) existing.value += amount;
    else this.values.set(key, { labels, value: amount });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) return lines.concat(`${this.name} 0`).join('\n');
    for (const { labels, value } of this.values.values()) {
      const rendered = labelKey(labels);
      lines.push(rendered ? `${this.name}{${rendered}} ${value}` : `${this.name} ${value}`);
    }
    return lines.join('\n');
  }

  reset() {
    this.values.clear();
  }
}

const HISTOGRAM_BUCKETS_SECONDS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram {
  private readonly series = new Map<
    string,
    { labels: Labels; buckets: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly buckets: number[] = HISTOGRAM_BUCKETS_SECONDS,
  ) {}

  observe(seconds: number, labels: Labels = {}) {
    const key = labelKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels, buckets: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    for (let i = 0; i < this.buckets.length; i += 1) {
      const upperBound = this.buckets[i];
      if (upperBound === undefined) continue;
      if (seconds <= upperBound) series.buckets[i] = (series.buckets[i] ?? 0) + 1;
    }
    series.sum += seconds;
    series.count += 1;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, buckets, sum, count } of this.series.values()) {
      const base = labelKey(labels);
      const withLabel = (extra: string) => {
        const combined = [base, extra].filter(Boolean).join(',');
        return combined ? `{${combined}}` : '';
      };
      for (let i = 0; i < this.buckets.length; i += 1) {
        const upperBound = this.buckets[i];
        lines.push(`${this.name}_bucket${withLabel(`le="${upperBound}"`)} ${buckets[i] ?? 0}`);
      }
      lines.push(`${this.name}_bucket${withLabel('le="+Inf"')} ${count}`);
      lines.push(`${this.name}_sum${base ? `{${base}}` : ''} ${sum}`);
      lines.push(`${this.name}_count${base ? `{${base}}` : ''} ${count}`);
    }
    return lines.join('\n');
  }

  reset() {
    this.series.clear();
  }
}

const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total HTTP requests by route template, method, and status family.',
);
const httpRequestDurationSeconds = new Histogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds, by route template and method.',
);
const authFailuresTotal = new Counter(
  'auth_failures_total',
  'Authentication failures by reason code.',
);
const rateLimitRejectionsTotal = new Counter(
  'rate_limit_rejections_total',
  'Requests rejected by rate limiting, by route template.',
);
const mediaTransitionFailuresTotal = new Counter(
  'media_transition_failures_total',
  'Rejected media state transitions, by transition.',
);
const contactNotificationTotal = new Counter(
  'contact_notification_total',
  'Contact notification delivery attempts, by result.',
);
const databaseFailuresTotal = new Counter(
  'database_failures_total',
  'Unhandled database errors observed at the HTTP boundary.',
);

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Bounds the `method` label to the fixed HTTP verbs this API actually uses — anything else
 * (a malformed request line) collapses to `OTHER` rather than passing arbitrary client input
 * through as a label value. */
function normalizeMethod(method: string): string {
  return KNOWN_METHODS.has(method) ? method : 'OTHER';
}

/** Maps a raw status code to one of five fixed families — never the raw code, and never the
 * route for an unmatched path (see `normalizeRoute`), keeps this label set small forever. */
function statusFamily(statusCode: number): string {
  const family = Math.floor(statusCode / 100);
  return family >= 1 && family <= 5 ? `${family}xx` : 'other';
}

/** `matchedRoute` is Express's own resolved route template (`req.route?.path`) — undefined for
 * anything that never matched a registered route (a 404 on an arbitrary path). Only ever a
 * template with literal `:param` placeholders, since that's what Express populates `route.path`
 * with — never the request's actual resolved path. */
function normalizeRoute(matchedRoute: string | undefined): string {
  return matchedRoute ?? 'unmatched';
}

export function recordHttpRequest(input: {
  matchedRoute: string | undefined;
  method: string;
  statusCode: number;
  durationMs: number;
}): void {
  const route = normalizeRoute(input.matchedRoute);
  const method = normalizeMethod(input.method);
  const labels = { route, method, status: statusFamily(input.statusCode) };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(input.durationMs / 1000, { route, method });
}

/** `reason` is always one of this app's own bounded exception codes (auth.exceptions.ts) or the
 * generic `HTTP_401` fallback — never a message string, which could otherwise vary per request. */
export function recordAuthFailure(reason: string): void {
  authFailuresTotal.inc({ reason });
}

export function recordRateLimitRejection(matchedRoute: string | undefined): void {
  rateLimitRejectionsTotal.inc({ route: normalizeRoute(matchedRoute) });
}

export type MediaTransition = 'approve' | 'reject' | 'archive';
export function recordMediaTransitionFailure(transition: MediaTransition): void {
  mediaTransitionFailuresTotal.inc({ transition });
}

export function recordContactNotification(delivered: boolean): void {
  contactNotificationTotal.inc({ result: delivered ? 'success' : 'failure' });
}

export function recordDatabaseFailure(): void {
  databaseFailuresTotal.inc();
}

export function renderPrometheusText(readinessOk: boolean): string {
  const uptimeSeconds = Number(process.hrtime.bigint() - processStartedAt) / 1e9;
  return (
    [
      '# HELP process_uptime_seconds Time since this process started, in seconds.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${uptimeSeconds.toFixed(3)}`,
      '',
      httpRequestsTotal.render(),
      '',
      httpRequestDurationSeconds.render(),
      '',
      '# HELP readiness_status Readiness check result (1 = ready, 0 = not ready).',
      '# TYPE readiness_status gauge',
      `readiness_status ${readinessOk ? 1 : 0}`,
      '',
      authFailuresTotal.render(),
      '',
      rateLimitRejectionsTotal.render(),
      '',
      mediaTransitionFailuresTotal.render(),
      '',
      contactNotificationTotal.render(),
      '',
      databaseFailuresTotal.render(),
    ].join('\n') + '\n'
  );
}

/** Test-only — resets every counter/histogram between cases so assertions on specific increments
 * don't depend on the order tests happen to run in. */
export function resetMetricsForTests(): void {
  httpRequestsTotal.reset();
  httpRequestDurationSeconds.reset();
  authFailuresTotal.reset();
  rateLimitRejectionsTotal.reset();
  mediaTransitionFailuresTotal.reset();
  contactNotificationTotal.reset();
  databaseFailuresTotal.reset();
}
