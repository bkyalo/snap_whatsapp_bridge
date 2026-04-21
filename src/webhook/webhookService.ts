import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';

export type WebhookEvent = 
  | 'message.status.update'
  | 'message.inbound'
  | 'session.update';

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: any;
}

/**
 * Service for dispatching secure, signed webhooks to the Laravel application.
 * All payloads are signed with HMAC-SHA256 using the share secret.
 */
export class WebhookService {
  /**
   * Dispatches an event to the configured Laravel webhook URL.
   * Fails silently (logs error) if not configured or execution fails.
   */
  static async notify(event: WebhookEvent, data: any): Promise<void> {
    const { url, secret } = config.webhook;

    if (!url) {
      // logger.trace({ event }, 'Webhook skip: No URL configured');
      return;
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);
    const signature = this.calculateSignature(body, secret);

    try {
      logger.debug({ event, url }, 'Dispatching webhook');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Bridge-Signature': signature,
          'User-Agent': `SNAP-Bridge/${config.meta.version}`,
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        logger.warn(
          { event, status: response.status, response: text.substring(0, 200) },
          'Webhook dispatch failed (HTTP Error)',
        );
      } else {
        logger.info({ event }, 'Webhook dispatched successfully');
      }
    } catch (err) {
      logger.error({ event, err }, 'Webhook dispatch failed (Network Error)');
    }
  }

  /**
   * Calculates HMAC-SHA256 signature for the request body.
   */
  private static calculateSignature(body: string, secret: string): string {
    if (!secret) return 'unsigned';
    
    return crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
  }
}
