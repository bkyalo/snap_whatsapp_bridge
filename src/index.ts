import { config } from './config';
import { logger } from './logger';
import { buildApp } from './server';
import { startSession } from './session/sessionManager';

/**
 * Main entry point.
 *
 * 1. Validates configuration (throws on missing required env vars)
 * 2. Builds the Fastify HTTP server
 * 3. Starts listening
 * 4. Initializes the WhatsApp session (non-blocking — status polls show progress)
 * 5. Registers graceful shutdown handlers
 */
async function main(): Promise<void> {
  logger.info({ version: config.meta.version, env: config.meta.env }, 'Starting SNAP Bridge');

  // Build and start HTTP server
  const app = await buildApp();

  await app.listen({
    host: config.server.host,
    port: config.server.port,
  });

  logger.info(
    { host: config.server.host, port: config.server.port },
    'HTTP server listening',
  );

  // Start the WhatsApp session (non-blocking — QR appears asynchronously)
  logger.info('Initializing WhatsApp session...');
  startSession().catch((err) => {
    logger.warn({ err }, 'Initial session start failed — you can retry via POST /session/start');
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    // Close HTTP server — stops accepting new connections
    await app.close();
    logger.info('HTTP server closed');

    // Note: we do NOT call logout() on SIGTERM/SIGINT.
    // The Baileys session is persistent and should survive restarts.
    // The socket connection will drop and reconnect on next start.
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
    process.exit(1);
  });
}

main().catch((err) => {
  // Config validation or server startup failure
  console.error('❌ SNAP Bridge failed to start:', err);
  process.exit(1);
});
