/**
 * Minimal structured logger. Every log line is a single JSON object with a
 * level, message, timestamp, and optional context — never a bare
 * console.log — so logs are greppable and parseable by any log aggregator
 * this app is eventually deployed behind (Vercel's log drains, etc).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  const line = JSON.stringify(entry);

  // eslint-disable-next-line no-console -- this is the one sanctioned sink for structured logs
  if (level === "error") {
    console.error(line);
    // eslint-disable-next-line no-console
  } else if (level === "warn") {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

/** Structured logger used everywhere in place of console.log. */
export const logger = {
  /** Verbose diagnostic detail, e.g. individual pipeline step inputs/outputs. */
  debug: (message: string, context?: LogContext): void => write("debug", message, context),
  /** Normal operational events, e.g. "research pipeline completed for company X". */
  info: (message: string, context?: LogContext): void => write("info", message, context),
  /** Recoverable problems, e.g. "Tavily search returned no results, continuing with partial data". */
  warn: (message: string, context?: LogContext): void => write("warn", message, context),
  /** Unrecoverable failures that the caller could not continue past. */
  error: (message: string, context?: LogContext): void => write("error", message, context),
};
