import { FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Registers @fastify/rate-limit globally with the configured window/max.
 *
 * The /health endpoint intentionally has a higher threshold since monitoring
 * tools poll frequently. Override per-route with:
 *   config: { rateLimit: { max: N, timeWindow: M } }
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    keyGenerator: (request) =>
      // Key by IP address. Replace with API key if you add per-key limits later.
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip,
    errorResponseBuilder: (_request, context) => ({
      ok: false,
      error: 'TooManyRequests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
    onExceeded: (request) => {
      logger.warn({ ip: request.ip, url: request.url }, 'Rate limit exceeded');
    },
  });
}
