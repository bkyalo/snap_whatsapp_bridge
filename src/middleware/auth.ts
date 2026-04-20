import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

/**
 * Bearer token authentication preHandler.
 *
 * Expects:  Authorization: Bearer <token>
 *
 * Returns 401 on missing/invalid token.
 * Returns 403 if the token format is correct but value does not match.
 *
 * Skip this preHandler on the /health route (added via route-level override).
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers['authorization'];

  if (!authHeader) {
    return reply.status(401).send({
      ok: false,
      error: 'Unauthorized',
      message: 'Missing Authorization header. Expected: Bearer <token>',
    });
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return reply.status(401).send({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid Authorization format. Expected: Bearer <token>',
    });
  }

  const token = parts[1];

  if (token !== config.security.bridgeToken) {
    return reply.status(403).send({
      ok: false,
      error: 'Forbidden',
      message: 'Invalid bridge token',
    });
  }
}
