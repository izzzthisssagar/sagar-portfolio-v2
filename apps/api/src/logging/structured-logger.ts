import type { LoggerService } from '@nestjs/common';
import { redact } from './redact';

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<AppLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface StructuredLoggerOptions {
  serviceName: string;
  releaseSha: string;
  format: 'json' | 'pretty';
  level: AppLogLevel;
  /** Injectable sink for tests — never writes through the real console in a test run. */
  write?: (line: string, level: AppLogLevel) => void;
}

export interface LogEntryFields {
  [key: string]: unknown;
}

/**
 * One structured log line per call — JSON in production (machine-parseable by whatever log
 * aggregator ingests stdout), a compact human-readable line otherwise. Every field passed via
 * `fields` is recursively redacted (see `redact.ts`) before it's ever serialized, so a caller
 * accidentally passing a whole request/response object through does not leak a token or
 * password just because nobody remembered to strip it at the call site.
 *
 * Implements Nest's `LoggerService` so `app.useLogger(...)` routes every internal Nest lifecycle
 * message through the same structured/redacted pipeline as application-level logging.
 */
export class StructuredLogger implements LoggerService {
  constructor(private readonly options: StructuredLoggerOptions) {}

  private shouldLog(level: AppLogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.options.level];
  }

  private emit(level: AppLogLevel, message: string, fields?: LogEntryFields): void {
    if (!this.shouldLog(level)) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.options.serviceName,
      releaseSha: this.options.releaseSha,
      message,
      ...(redact(fields ?? {}) as LogEntryFields),
    };
    const line =
      this.options.format === 'json'
        ? JSON.stringify(entry)
        : `[${entry.timestamp}] ${level.toUpperCase()} ${this.options.serviceName} — ${message}${
            fields && Object.keys(fields).length ? ` ${JSON.stringify(redact(fields))}` : ''
          }`;
    const sink =
      this.options.write ?? ((l) => (level === 'error' ? console.error(l) : console.log(l)));
    sink(line, level);
  }

  /** Structured entry point for application code — prefer this over the Nest-lifecycle methods
   * below, which exist only to satisfy `LoggerService`. */
  logStructured(level: AppLogLevel, message: string, fields?: LogEntryFields): void {
    this.emit(level, message, fields);
  }

  log(message: unknown, context?: string): void {
    this.emit('info', String(message), context ? { context } : undefined);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.emit('error', String(message), {
      ...(context ? { context } : {}),
      ...(trace ? { trace } : {}),
    });
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', String(message), context ? { context } : undefined);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', String(message), context ? { context } : undefined);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('debug', String(message), context ? { context } : undefined);
  }
}
