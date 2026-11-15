import type { LoggerService } from '@nestjs/common';
import { currentRequest } from './request-context';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/** Keys whose values are never written to a log, at any depth. */
const SENSITIVE =
  /(authorization|cookie|password|secret|token|api[-_]?key|code_verifier|nonce|id_token)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  // An Error has no enumerable fields: without this it is written as {} and the reason is lost. Found on
  // 2026-11-14: a broken key file stopped the backend with the log line `"message":{}`.
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** One JSON object per line, with the request id. Stdout only: the platform decides where logs go (SIEM, files). */
export class JsonLogger implements LoggerService {
  constructor(private readonly min: Level = 'info') {}

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (LEVELS[level] < LEVELS[this.min]) return;
    // The framework hands a start-up failure over as the Error itself: write its text and where it came from.
    if (message instanceof Error) {
      extra = {
        errorName: message.name,
        ...(message.stack ? { stack: message.stack } : {}),
        ...extra,
      };
      message = message.message;
    }
    const line = {
      time: new Date().toISOString(),
      level,
      context,
      requestId: currentRequest()?.requestId,
      message: typeof message === 'string' ? message : redact(message),
      ...(extra ? (redact(extra) as object) : {}),
    };
    (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }
  error(message: unknown, stack?: string, context?: string) {
    this.write('error', message, context, stack ? { stack } : undefined);
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
}
