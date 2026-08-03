/** Every key that must never appear in a log line, regardless of nesting depth or which object it
 * came from — matched case-insensitively against the key name itself, not its value, since the
 * whole point is not having to trust that a value "looks safe" before deciding to log it. */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|smtp_|access_key|secret_key|connectionstring|database_url|apikey|api_key)/i;

const REDACTED = '[redacted]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively walks an arbitrary value and replaces any value whose key matches
 * `SENSITIVE_KEY_PATTERN` with `[redacted]` — used before anything is handed to the logger, so a
 * field added to a payload later (a new DTO property, a new header) is redacted by pattern
 * rather than requiring every call site to remember to strip it by hand. Never mutates the input.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED; // guards against a pathological/circular-ish input, not real data
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(v, depth + 1);
  }
  return result;
}

/** Redacts a raw HTTP header bag by name — headers are keyed by header name, not a nested object,
 * so this checks the key directly rather than delegating to `redact`'s object walk (which would
 * also redact ordinary headers whose *value* happens to look secret-shaped, which isn't the rule
 * here — only known sensitive header names are stripped). */
export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = /^(authorization|cookie|set-cookie|x-csrf-token|x-health-token)$/i.test(key)
      ? REDACTED
      : value;
  }
  return result;
}
