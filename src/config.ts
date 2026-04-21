import 'dotenv/config';

/**
 * Centralized, validated configuration loaded from environment variables.
 * The bridge will refuse to start if required variables are missing.
 */

function require_env(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optional_env(key: string, defaultValue: string = ''): string {
  return (process.env[key] ?? defaultValue).trim();
}

function optional_int(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer, got: "${raw}"`);
  return parsed;
}

export const config = {
  server: {
    host: optional_env('HOST', '127.0.0.1'),
    port: optional_int('PORT', 3000),
  },

  security: {
    /** Bearer token required for all protected endpoints */
    bridgeToken: require_env('BRIDGE_TOKEN'),
  },

  session: {
    /** Directory for Baileys multi-file auth credentials */
    authStateDir: optional_env('AUTH_STATE_DIR', './auth_state'),
  },

  webhook: {
    /** Laravel URL to POST inbound events to. Empty = disabled. */
    url: optional_env('LARAVEL_WEBHOOK_URL', ''),
    /** HMAC-SHA256 secret for signing payloads */
    secret: optional_env('LARAVEL_WEBHOOK_SECRET', ''),
    /** Max retries for a single webhook event */
    maxRetries: 5,
  },

  logging: {
    level: optional_env('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    pretty: optional_env('NODE_ENV', 'production') === 'development',
  },

  rateLimit: {
    max: optional_int('RATE_LIMIT_MAX', 30),
    windowMs: optional_int('RATE_LIMIT_WINDOW_MS', 60_000),
  },

  /** Build-time metadata */
  meta: {
    version: process.env.npm_package_version ?? '1.0.0',
    env: optional_env('NODE_ENV', 'production'),
  },
} as const;

export type Config = typeof config;
