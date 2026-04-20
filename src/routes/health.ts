import { FastifyInstance } from 'fastify';
import { config } from '../config';

/**
 * GET /health
 *
 * Returns service health information.
 * No authentication required — safe to poll from monitoring tools.
 *
 * Rate limit is higher on this endpoint (120 req/min).
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: 60_000,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        ok: true,
        status: 'healthy',
        version: config.meta.version,
        env: config.meta.env,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    },
  );
}
