import * as Sentry from '@sentry/nextjs';
import { validateOutboundUrl } from '@elogbook/shared/security/outbound-url';
import {
  REDACTED,
  createEventId,
  redact,
  redactPHI,
  type RedactionOptions,
} from './observability/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

const SENTRY_TAGS = new Set([
  'action', 'category', 'component', 'environment', 'eventid', 'level', 'method', 'operation', 'operationid', 'phase', 'provider', 'release', 'route', 'severity', 'source', 'status', 'statuscode', 'transaction', 'type',
]);

function isRecord(value: unknown): value is LogContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isError(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hostEntries(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function allowedLogHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...hostEntries(env.LOG_ALLOWED_HOSTS),
    ...hostEntries(env.LOG_ENDPOINT_ALLOWED_HOSTS),
    ...hostEntries(env.LOG_ENDPOINT_ALLOWLIST),
    ...hostEntries(env.OUTBOUND_ALLOWED_HOSTS),
  ];
}

function isAllowedLogHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return allowedHosts.some((entry) => {
    const wildcard = entry.startsWith('*.');
    const candidate = entry.replace(/^\*\./, '').replace(/\.$/, '');
    return wildcard ? normalized.endsWith(`.${candidate}`) : normalized === candidate;
  });
}

function externalLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOG_EXTERNAL_ENABLED === 'true' || env.LOG_ENDPOINT_ENABLED === 'true' || env.LOG_EXTERNAL_LOGGING === 'true' || env.EXTERNAL_LOGGING_ENABLED === 'true' || env.LOG_ENDPOINT_OPT_IN === 'true';
}

function safeMessage(message: string, options: RedactionOptions = {}): string {
  const result = redact({ message }, options);
  return typeof result.message === 'string' ? result.message : '[REDACTED]';
}

function sanitizedError(error: unknown, options: RedactionOptions = {}): Record<string, unknown> {
  const result = redact({ error }, options) as { error?: unknown };
  return isRecord(result.error) ? result.error : { name: 'Error', message: '[REDACTED]' };
}

function safeTags(context: LogContext): Record<string, string | number | boolean> {
  const tags: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!SENTRY_TAGS.has(normalizedKey(key))) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') tags[key] = value;
  }
  return tags;
}

function omitRedactedValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitRedactedValues).filter((entry) => entry !== REDACTED);
  if (!isRecord(value)) return value;
  const result: LogContext = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === REDACTED) continue;
    result[key] = omitRedactedValues(entry);
  }
  return result;
}

function validateLogEndpoint(endpoint: string, env: NodeJS.ProcessEnv = process.env): URL | null {
  if (!externalLoggingEnabled(env)) return null;
  const allowedHosts = allowedLogHosts(env);
  if (allowedHosts.length === 0) return null;
  try {
    const url = validateOutboundUrl(endpoint, { allowedHosts, allowedPorts: [443] });
    if (!isAllowedLogHost(url.hostname, allowedHosts) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

class Logger {
  private sequence = 0;

  private shouldLog(level: LogLevel): boolean {
    if (process.env.NODE_ENV === 'production') return level === 'warn' || level === 'error';
    return true;
  }

  private nextEventId(level: LogLevel, message: string): string {
    this.sequence += 1;
    return createEventId('logger', `${level}:${message}:${Date.now()}:${this.sequence}`);
  }

  private emit(level: LogLevel, message: string, error?: unknown, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const redactionOptions: RedactionOptions = { mode: process.env.NODE_ENV === 'production' ? 'allowlist' : 'compat' };
    const safeMessageValue = safeMessage(message, redactionOptions);
    const safeContext = redact(context ?? {}, redactionOptions);
    const safeMeta = isRecord(safeContext) ? safeContext : { value: safeContext };
    const errorFields = error === undefined ? {} : sanitizedError(error, redactionOptions);
    const eventId = this.nextEventId(level, safeMessageValue);
    const entry: Record<string, unknown> = {
      ...safeMeta,
      ts: new Date().toISOString(),
      eventId,
      level,
      msg: safeMessageValue,
      ...errorFields,
    };

    const line = JSON.stringify(entry);
    const logFn = level === 'error'
      ? console.error
      : level === 'warn'
        ? process.env.NODE_ENV === 'production' ? console.warn : console.error
        : console.log;
    logFn(line);

    if (level === 'error' || level === 'warn') {
      this.sendToSentry(level, eventId, safeMeta);
    }

    if (process.env.NODE_ENV === 'production') {
      void this.sendToExternalLogger(entry);
    }
  }

  private sendToSentry(level: LogLevel, eventId: string, context: LogContext): void {
    const sentryContext = redact(context, { mode: 'allowlist' });
    const safeContextValue = omitRedactedValues(sentryContext);
    const safeContext = isRecord(safeContextValue) ? safeContextValue : {};
    delete safeContext.eventId;
    delete safeContext.event_id;
    delete safeContext.level;
    delete safeContext.msg;
    delete safeContext.ts;
    Sentry.captureMessage(eventId, {
      level: level === 'error' ? 'error' : 'warning',
      contexts: { custom: safeContext },
      tags: { ...safeTags(safeContext), eventId },
    });
  }

  private async sendToExternalLogger(entry: Record<string, unknown>): Promise<void> {
    const endpoint = validateLogEndpoint(process.env.LOG_ENDPOINT ?? '');
    if (!endpoint) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.LOG_API_KEY) headers.Authorization = `Bearer ${process.env.LOG_API_KEY}`;
    try {
      await fetch(endpoint.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(redact(entry, { mode: 'allowlist' })),
        redirect: 'manual',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      return;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.emit('debug', message, undefined, context);
  }

  info(message: string, context?: LogContext): void {
    this.emit('info', message, undefined, context);
  }

  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, undefined, context);
  }

  error(message: string | Error, errorOrContext?: unknown, context?: LogContext): void {
    if (typeof message === 'string') {
      if (isError(errorOrContext)) {
        this.emit('error', message, errorOrContext, context);
      } else if (isRecord(errorOrContext)) {
        this.emit('error', message, undefined, errorOrContext);
      } else {
        this.emit('error', message, errorOrContext, context);
      }
      return;
    }
    this.emit('error', message.message, message, isRecord(errorOrContext) ? errorOrContext : context);
  }
}

export const logger = new Logger();
export { redactPHI };
