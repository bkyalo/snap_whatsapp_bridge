import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import {
  startSession,
  getStatus,
  getQrDataUrl,
  logout,
} from '../session/sessionManager';
import { logger } from '../logger';

/**
 * Session management routes — all protected by Bearer token.
 *
 * POST  /session/start   — Start or restart the WhatsApp session
 * GET   /session/status  — Get current session status
 * GET   /session/qr      — Get QR code as data URL (when status = qr_pending)
 * POST  /logout          — Log out and clear stored credentials
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // Apply auth to all routes in this plugin
  app.addHook('preHandler', authMiddleware);

  // ---------------------------------------------------------------------------
  // POST /session/start
  // ---------------------------------------------------------------------------
  app.post('/session/start', async (_request, reply) => {
    try {
      await startSession();
      const status = getStatus();
      return reply.status(200).send({
        ok: true,
        message: 'Session initializing. Poll /session/status for readiness.',
        status: status.status,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to start session');
      return reply.status(500).send({
        ok: false,
        error: 'SessionStartFailed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /session/status
  // ---------------------------------------------------------------------------
  app.get('/session/status', async (_request, reply) => {
    const status = getStatus();
    return reply.status(200).send({
      ok: true,
      ...status,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /session/qr
  // ---------------------------------------------------------------------------
  app.get('/session/qr', async (_request, reply) => {
    const status = getStatus();

    if (!status.hasQr) {
      return reply.status(404).send({
        ok: false,
        error: 'QrNotAvailable',
        message: `No QR code available. Current session status: "${status.status}". ` +
          `Call POST /session/start first, then poll until status is "qr_pending".`,
      });
    }

    const dataUrl = getQrDataUrl();

    return reply.status(200).send({
      ok: true,
      qr: dataUrl,
      message: 'Scan this QR code with your WhatsApp mobile app within 60 seconds.',
    });
  });

  // ---------------------------------------------------------------------------
  // POST /logout
  // ---------------------------------------------------------------------------
  app.post('/logout', async (_request, reply) => {
    try {
      await logout();
      return reply.status(200).send({
        ok: true,
        message: 'Session logged out. Stored credentials cleared. Call POST /session/start to re-link.',
      });
    } catch (err) {
      logger.error({ err }, 'Error during logout');
      return reply.status(500).send({
        ok: false,
        error: 'LogoutFailed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
