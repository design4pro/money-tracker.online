/**
 * Structured logging for the money-tracker.online Worker.
 *
 * Every line is a single JSON object on one line so Workers Observability can
 * index the fields and `wrangler tail --format json` stays greppable. The only
 * place in the codebase that talks to the runtime console is `consoleSink`
 * below — everything else logs through a `Logger`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'])

/** Values that survive `JSON.stringify` intact. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null>
  | { [key: string]: string | number | boolean | null | undefined }

export type LogFields = Record<string, LogValue>

/** Fields that identify *where* a log line came from. */
export interface LogContext {
  /** Correlates every line emitted while handling one request. */
  requestId?: string
  /** Tenant the request is acting on. Never log a raw email or token. */
  orgId?: string
  userId?: string
  /** Route id (`/api/tiles/$`) or job name (`queue:pdf-export`). */
  route?: string
  method?: string
  /** `worker` | `queue` | `scheduled` | `durable-object`. */
  component?: string
  environment?: string
  /** Cloudflare colo that served the request, from `cf.colo`. */
  colo?: string
}

export interface LogRecord extends LogFields {
  ts: string
  level: LogLevel
  msg: string
  service: string
}

export interface LogSink {
  write: (record: LogRecord) => void
}

export interface Logger {
  readonly level: LogLevel
  readonly context: LogContext
  enabled: (level: LogLevel) => boolean
  debug: (msg: string, fields?: LogFields) => void
  info: (msg: string, fields?: LogFields) => void
  warn: (msg: string, fields?: LogFields) => void
  error: (msg: string, error?: unknown, fields?: LogFields) => void
  /** Returns a logger that inherits this one's context plus `context`. */
  child: (context: LogContext & LogFields) => Logger
  /**
   * Times `fn`, emits one completion line with `durationMs` and `outcome`, and
   * re-throws so the caller's control flow is unchanged.
   */
  track: <T>(
    msg: string,
    fn: () => Promise<T>,
    fields?: LogFields,
  ) => Promise<T>
}

export interface CreateLoggerOptions {
  level?: LogLevel
  service?: string
  context?: LogContext & LogFields
  sink?: LogSink
  now?: () => number
}

const DEFAULT_SERVICE = 'money-tracker'

/**
 * The single console boundary. Levels map onto the console methods Workers
 * Observability records, so a `warn` stays a `warn` in the dashboard.
 */
export const consoleSink: LogSink = {
  write(record) {
    const line = JSON.stringify(record)
    switch (record.level) {
      case 'debug':
        console.debug(line)
        return
      case 'info':
        console.info(line)
        return
      case 'warn':
        console.warn(line)
        return
      case 'error':
        console.error(line)
        return
    }
  },
}

/** Collects records in memory. Used by tests and by the health endpoint. */
export function createMemorySink(): LogSink & { records: Array<LogRecord> } {
  const records: Array<LogRecord> = []
  return {
    records,
    write(record) {
      records.push(record)
    },
  }
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LOG_LEVELS.has(value)
}

/** Reads `LOG_LEVEL` from `vars`, falling back to `info`. */
export function resolveLogLevel(
  value: unknown,
  fallback: LogLevel = 'info',
): LogLevel {
  return isLogLevel(value) ? value : fallback
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

/** Normalises anything thrown into loggable fields. */
export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const fields: LogFields = {
      errorName: error.name,
      errorMessage: error.message,
    }
    if (typeof error.stack === 'string') {
      fields.errorStack = error.stack.slice(0, 2000)
    }
    const cause = error.cause
    if (cause !== undefined && cause !== null) {
      fields.errorCause =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
          : String(cause)
    }
    return fields
  }
  return { errorName: 'NonError', errorMessage: String(error) }
}

function compact(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const key of Object.keys(fields)) {
    const value = fields[key]
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const service = options.service ?? DEFAULT_SERVICE
  const sink = options.sink ?? consoleSink
  const now = options.now ?? (() => Date.now())
  const context = compact({ ...options.context })
  const threshold = LEVEL_RANK[level]

  function emit(recordLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_RANK[recordLevel] < threshold) return
    sink.write({
      ts: new Date(now()).toISOString(),
      level: recordLevel,
      msg,
      service,
      ...context,
      ...(fields ? compact(fields) : {}),
    })
  }

  const logger: Logger = {
    level,
    get context() {
      return context as LogContext
    },
    enabled(candidate) {
      return LEVEL_RANK[candidate] >= threshold
    },
    debug(msg, fields) {
      emit('debug', msg, fields)
    },
    info(msg, fields) {
      emit('info', msg, fields)
    },
    warn(msg, fields) {
      emit('warn', msg, fields)
    },
    error(msg, error, fields) {
      emit('error', msg, {
        ...(error === undefined ? {} : serializeError(error)),
        ...fields,
      })
    },
    child(childContext) {
      return createLogger({
        level,
        service,
        sink,
        now,
        context: { ...context, ...childContext },
      })
    },
    async track(msg, fn, fields) {
      const startedAt = now()
      try {
        const result = await fn()
        emit('info', msg, {
          ...fields,
          outcome: 'ok',
          durationMs: now() - startedAt,
        })
        return result
      } catch (error) {
        emit('error', msg, {
          ...fields,
          outcome: 'error',
          durationMs: now() - startedAt,
          ...serializeError(error),
        })
        throw error
      }
    },
  }

  return logger
}

interface RequestLikeCf {
  colo?: unknown
  country?: unknown
}

interface RequestLike {
  method: string
  url: string
  headers: { get: (name: string) => string | null }
  cf?: RequestLikeCf
}

/** Request fields worth indexing. Deliberately excludes cookies and auth headers. */
export function requestFields(request: RequestLike): LogFields {
  const url = new URL(request.url)
  const cf = request.cf
  return compact({
    method: request.method,
    path: url.pathname,
    colo: typeof cf?.colo === 'string' ? cf.colo : undefined,
    country: typeof cf?.country === 'string' ? cf.country : undefined,
    ray: request.headers.get('cf-ray') ?? undefined,
    referrer: request.headers.get('referer') ?? undefined,
  })
}

/** Fields describing a response, paired with `requestFields`. */
export function responseFields(
  status: number,
  durationMs: number,
  extra?: LogFields,
): LogFields {
  return compact({ status, durationMs, ...extra })
}

export interface LoggerFromEnvOptions extends Omit<
  CreateLoggerOptions,
  'level' | 'context'
> {
  context?: LogContext & LogFields
}

interface LoggerEnvLike {
  LOG_LEVEL?: unknown
  ENVIRONMENT?: unknown
}

/** Builds the request-scoped logger from `vars`. */
export function loggerFromEnv(
  env: LoggerEnvLike,
  options: LoggerFromEnvOptions = {},
): Logger {
  return createLogger({
    ...options,
    level: resolveLogLevel(env.LOG_LEVEL),
    context: {
      environment:
        typeof env.ENVIRONMENT === 'string' ? env.ENVIRONMENT : undefined,
      ...options.context,
    },
  })
}
