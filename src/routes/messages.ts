import { FastifyInstance, FastifyRequest } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { sendText } from '../session/sessionManager';
import { PhoneNormalizationError } from '../phoneUtils';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Request/Response Schemas (Fastify JSON schema validation)
// ---------------------------------------------------------------------------

const sendTextBodySchema = {
  type: 'object',
  required: ['phone', 'message'],
  properties: {
    phone: {
      type: 'string',
      minLength: 7,
      maxLength: 20,
      description: 'Recipient phone number (E.164 or Kenyan local format)',
    },
    message: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description: 'Plain text message body',
    },
    reference: {
      type: 'string',
      maxLength: 255,
      description: 'Optional internal reference/ID for correlating with Laravel records',
    },
  },
  additionalProperties: false,
} as const;

interface SendTextBody {
  phone: string;
  message: string;
  reference?: string;
}

/**
 * Message sending routes — all protected by Bearer token.
 *
 * POST /send-text — Send a plain text WhatsApp message
 */
export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ---------------------------------------------------------------------------
  // POST /send-text
  // ---------------------------------------------------------------------------
  app.post<{ Body: SendTextBody }>(
    '/send-text',
    {
      schema: {
        body: sendTextBodySchema,
      },
    },
    async (request: FastifyRequest<{ Body: SendTextBody }>, reply) => {
      const { phone, message, reference } = request.body;

      logger.info(
        { phone, reference: reference ?? null, messageLength: message.length },
        'Processing send-text request',
      );

      try {
        const result = await sendText(phone, message);

        return reply.status(200).send({
          ok: true,
          message_id: result.messageId,
          phone: result.phone,
          reference: reference ?? null,
          timestamp: result.timestamp,
        });
      } catch (err) {
        if (err instanceof PhoneNormalizationError) {
          logger.warn({ phone, err: err.message }, 'Invalid phone number');
          return reply.status(422).send({
            ok: false,
            error: 'InvalidPhone',
            message: err.message,
            phone,
          });
        }

        // Session not ready
        if (err instanceof Error && err.message.includes('session status is')) {
          logger.warn({ err: err.message }, 'Attempted to send while session not connected');
          return reply.status(503).send({
            ok: false,
            error: 'SessionNotReady',
            message: err.message,
          });
        }

        logger.error({ err, phone, reference }, 'Failed to send WhatsApp message');
        return reply.status(500).send({
          ok: false,
          error: 'SendFailed',
          message: err instanceof Error ? err.message : 'Message send failed',
          reference: reference ?? null,
        });
      }
    },
  );
}
