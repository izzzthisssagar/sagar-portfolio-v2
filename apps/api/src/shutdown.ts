export interface ShutdownableApp {
  close(): Promise<unknown>;
}

export interface Logger {
  log(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface ShutdownOptions {
  /** Bounded wait for `app.close()` (which itself waits for in-flight requests and runs every
   * `OnModuleDestroy` hook — Prisma's disconnect among them) before forcing the process to exit
   * anyway. A hung close must never leave the process running forever. */
  gracePeriodMs: number;
  exit?: (code: number) => void;
  logger?: Logger;
  /** Injectable for tests — attaching to a real `process` would require sending real signals to
   * the test runner's own process. */
  process?: Pick<NodeJS.Process, 'on'>;
}

export type ShutdownHandler = (signal: NodeJS.Signals) => Promise<void>;

/**
 * Registers SIGTERM/SIGINT handlers that call `app.close()` (stopping new work and running every
 * `OnModuleDestroy` hook) and exit 0 on success, or force-exit 1 if `close()` throws or exceeds
 * `gracePeriodMs`. Idempotent — a second signal during an in-progress shutdown is a no-op rather
 * than starting a second, overlapping shutdown sequence. Returns the handler directly so tests
 * can invoke it without emitting a real OS signal.
 */
export function registerGracefulShutdown(
  app: ShutdownableApp,
  options: ShutdownOptions,
): ShutdownHandler {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? console;
  const proc = options.process ?? process;
  let shuttingDown = false;

  // Deliberately not `async/await` over `app.close()` — in production, `exit()` (`process.exit`)
  // terminates the event loop immediately, so it never matters whether `close()` eventually
  // settles after that. In tests, `exit` is a no-op stand-in, so this function's own returned
  // promise must resolve as soon as *either* the grace-period timer or `close()` settles,
  // whichever comes first — otherwise a `close()` that never resolves (the exact case the timer
  // exists to handle) would leave the test awaiting a promise that never settles.
  const shutdown: ShutdownHandler = (signal) =>
    new Promise<void>((resolveShutdown) => {
      if (shuttingDown) {
        resolveShutdown();
        return;
      }
      shuttingDown = true;
      logger.log(
        `Received ${signal} — closing gracefully (grace period ${options.gracePeriodMs}ms).`,
      );
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.error(`Graceful shutdown exceeded ${options.gracePeriodMs}ms — forcing exit.`);
        exit(1);
        resolveShutdown();
      }, options.gracePeriodMs);
      timer.unref?.();
      app.close().then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          exit(0);
          resolveShutdown();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          logger.error('Error while closing the application.', error);
          exit(1);
          resolveShutdown();
        },
      );
    });

  proc.on('SIGTERM', () => void shutdown('SIGTERM'));
  proc.on('SIGINT', () => void shutdown('SIGINT'));
  return shutdown;
}
