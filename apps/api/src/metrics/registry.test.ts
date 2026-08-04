import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordAuthFailure,
  recordContactNotification,
  recordDatabaseFailure,
  recordHttpRequest,
  recordMediaTransitionFailure,
  recordRateLimitRejection,
  renderPrometheusText,
  resetMetricsForTests,
} from './registry';

describe('metrics registry', () => {
  beforeEach(() => resetMetricsForTests());

  it('renders valid Prometheus text exposition with HELP/TYPE for every metric', () => {
    const text = renderPrometheusText(true);
    for (const name of [
      'process_uptime_seconds',
      'http_requests_total',
      'http_request_duration_seconds',
      'readiness_status',
      'auth_failures_total',
      'rate_limit_rejections_total',
      'media_transition_failures_total',
      'contact_notification_total',
      'database_failures_total',
    ]) {
      expect(text).toContain(`# HELP ${name}`);
      expect(text).toContain(`# TYPE ${name}`);
    }
  });

  it('bounds the method label to known HTTP verbs, never an arbitrary string', () => {
    recordHttpRequest({
      matchedRoute: '/api/v1/projects',
      method: 'TRACE',
      statusCode: 200,
      durationMs: 1,
    });
    const text = renderPrometheusText(true);
    expect(text).toContain('method="OTHER"');
    expect(text).not.toContain('method="TRACE"');
  });

  it('collapses status codes to one of five bounded families, never the raw code', () => {
    recordHttpRequest({
      matchedRoute: '/api/v1/projects',
      method: 'GET',
      statusCode: 418,
      durationMs: 1,
    });
    const text = renderPrometheusText(true);
    expect(text).toContain('status="4xx"');
    expect(text).not.toContain('418');
  });

  it('accumulates duration histogram observations without exposing raw per-request values', () => {
    recordHttpRequest({
      matchedRoute: '/api/v1/projects',
      method: 'GET',
      statusCode: 200,
      durationMs: 42,
    });
    const text = renderPrometheusText(true);
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/projects"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_sum{method="GET",route="/api/v1/projects"} 0.042',
    );
  });

  it('records auth failures by bounded reason code', () => {
    recordAuthFailure('INVALID_CREDENTIALS');
    recordAuthFailure('INVALID_CREDENTIALS');
    recordAuthFailure('SESSION_EXPIRED');
    const text = renderPrometheusText(true);
    expect(text).toContain('auth_failures_total{reason="INVALID_CREDENTIALS"} 2');
    expect(text).toContain('auth_failures_total{reason="SESSION_EXPIRED"} 1');
  });

  it('records rate-limit rejections by route template, collapsing unmatched routes', () => {
    recordRateLimitRejection('/api/v1/auth/login');
    recordRateLimitRejection(undefined);
    const text = renderPrometheusText(true);
    expect(text).toContain('rate_limit_rejections_total{route="/api/v1/auth/login"} 1');
    expect(text).toContain('rate_limit_rejections_total{route="unmatched"} 1');
  });

  it('records media transition failures by a bounded transition enum only', () => {
    recordMediaTransitionFailure('approve');
    recordMediaTransitionFailure('reject');
    recordMediaTransitionFailure('reject');
    const text = renderPrometheusText(true);
    expect(text).toContain('media_transition_failures_total{transition="approve"} 1');
    expect(text).toContain('media_transition_failures_total{transition="reject"} 2');
  });

  it('records contact notification outcomes as success/failure only, never message content', () => {
    recordContactNotification(true);
    recordContactNotification(false);
    recordContactNotification(false);
    const text = renderPrometheusText(true);
    expect(text).toContain('contact_notification_total{result="success"} 1');
    expect(text).toContain('contact_notification_total{result="failure"} 2');
  });

  it('records database failures as an unlabeled counter', () => {
    recordDatabaseFailure();
    recordDatabaseFailure();
    const text = renderPrometheusText(true);
    expect(text).toContain('database_failures_total 2');
  });

  it('reflects the readiness argument directly, never inferring it from other state', () => {
    expect(renderPrometheusText(true)).toContain('readiness_status 1');
    expect(renderPrometheusText(false)).toContain('readiness_status 0');
  });
});
