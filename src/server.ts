import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './logger';
import { registerRateLimit } from './middleware/rateLimit';
import { healthRoutes } from './routes/health';
import { sessionRoutes } from './routes/session';
import { messageRoutes } from './routes/messages';

/**
 * Builds and configures the Fastify application instance.
 * Separated from src/index.ts so it can be tested in isolation.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true, // Required for correct IP detection behind Nginx/reverse proxy
    ajv: {
      customOptions: {
        // Coerce types for query params (e.g. "true" → true)
        coerceTypes: true,
        // Remove extra properties not in schema
        removeAdditional: true,
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Security plugins
  // ---------------------------------------------------------------------------
  await app.register(fastifyHelmet, {
    // Disable CSP for an API-only service; add back if serving HTML
    contentSecurityPolicy: false,
  });

  await app.register(fastifyCors, {
    // CORS disabled by default — bridge is localhost-only.
    // Enable and configure if you add an admin UI served from a different origin.
    origin: false,
  });

  await registerRateLimit(app);

  // ---------------------------------------------------------------------------
  // Request logging via our structured logger
  // ---------------------------------------------------------------------------
  app.addHook('onRequest', async (request) => {
    logger.info(
      { method: request.method, url: request.url, ip: request.ip },
      'Incoming request',
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime.toFixed(2) + 'ms',
      },
      'Request completed',
    );
  });

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(messageRoutes);

  // ---------------------------------------------------------------------------
  // Global error handler — ensures all errors return structured JSON
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, _request, reply) => {
    // Fastify validation errors (schema failures)
    if (error.validation) {
      logger.warn({ validation: error.validation }, 'Request validation failed');
      return reply.status(422).send({
        ok: false,
        error: 'ValidationError',
        message: 'Request body failed validation',
        details: error.validation.map((v) => ({
          field: v.instancePath || v.schemaPath,
          message: v.message,
        })),
      });
    }

    // Rate limit errors from @fastify/rate-limit are handled by errorResponseBuilder in the plugin

    logger.error({ err: error }, 'Unhandled request error');
    return reply.status(error.statusCode ?? 500).send({
      ok: false,
      error: error.code ?? 'InternalError',
      message: config.meta.env === 'production'
        ? 'An internal error occurred'
        : error.message,
    });
  });

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      ok: false,
      error: 'NotFound',
      message: 'Endpoint not found',
    });
  });

  return app;
}
