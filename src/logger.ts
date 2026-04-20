import pino from 'pino';
import { config } from './config';

/**
 * Structured logger using pino.
 *
 * - Production: JSON output to stdout (suitable for journald / PM2 log rotation)
 * - Development: human-readable pretty output
 *
 * Sensitive fields are redacted from all log output.
 */
export const logger = pino({
  level: config.logging.level,

  // Redact sensitive fields from all log lines
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-bridge-token"]',
      'credentials',
      'creds',
      'qr',
      'pairingCode',
    ],
    censor: '[REDACTED]',
  },

  ...(config.logging.pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // In production, include timestamp as Unix epoch for easy parsing
        timestamp: pino.stdTimeFunctions.epochTime,
        formatters: {
          level: (label) => ({ level: label }),
        },
      }),
});

export type Logger = typeof logger;
