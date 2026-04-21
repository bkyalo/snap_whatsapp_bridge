import makeWASocket, {
  DisconnectReason,
  isJidBroadcast,
  WASocket,
  ConnectionState,
  proto,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { loadAuthState, clearAuthState } from './authState';
import { logger } from '../logger';
import { toWhatsAppJid, jidToPhone } from '../phoneUtils';
import { WebhookService } from '../webhook/webhookService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'qr_pending'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export interface SessionState {
  status: SessionStatus;
  /** QR code as data URL (png), available only when status === 'qr_pending' */
  qrDataUrl: string | null;
  /** Linked WhatsApp phone number (available after connect) */
  phone: string | null;
  /** Seconds since epoch of last successful connection */
  connectedAt: number | null;
}

export interface SendTextResult {
  messageId: string;
  phone: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal singleton state
// ---------------------------------------------------------------------------

let socket: WASocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 3_000;

let state: SessionState = {
  status: 'idle',
  qrDataUrl: null,
  phone: null,
  connectedAt: null,
};

function setState(patch: Partial<SessionState>): void {
  state = { ...state, ...patch };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts (or reconnects) the WhatsApp session.
 * Idempotent — safe to call if already connected.
 */
export async function startSession(): Promise<void> {
  if (state.status === 'connected' || state.status === 'connecting') {
    logger.info({ status: state.status }, 'startSession called but session already active');
    return;
  }

  setState({ status: 'connecting', qrDataUrl: null });
  reconnectAttempts = 0;
  await connect();
}

/**
 * Returns the current session status suitable for the /session/status endpoint.
 */
export function getStatus(): {
  ready: boolean;
  connected: boolean;
  hasQr: boolean;
  loggedOut: boolean;
  phone: string | null;
  status: SessionStatus;
} {
  return {
    ready: state.status === 'connected',
    connected: state.status === 'connected' || state.status === 'reconnecting',
    hasQr: state.status === 'qr_pending' && state.qrDataUrl !== null,
    loggedOut: state.status === 'logged_out',
    phone: state.phone,
    status: state.status,
  };
}

/**
 * Returns the current QR code as a data URL, or null if not available.
 */
export function getQrDataUrl(): string | null {
  if (state.status !== 'qr_pending') return null;
  return state.qrDataUrl;
}

/**
 * Sends a plain-text WhatsApp message.
 *
 * @throws Error if session is not connected or message send fails.
 */
export async function sendText(
  rawPhone: string,
  message: string,
): Promise<SendTextResult> {
  if (state.status !== 'connected' || !socket) {
    throw new Error(`Cannot send message: session status is "${state.status}"`);
  }

  const jid = toWhatsAppJid(rawPhone);
  const phone = jidToPhone(jid);

  logger.info({ jid }, 'Sending text message');

  const result = await socket.sendMessage(jid, { text: message });

  if (!result?.key?.id) {
    throw new Error('sendMessage returned an unexpected result — no message key');
  }

  return {
    messageId: result.key.id,
    phone,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Logs out and destroys the current session.
 * Clears stored credentials so the next startSession() requires re-linking.
 */
export async function logout(): Promise<void> {
  logger.info('Logging out WhatsApp session');

  cancelReconnect();

  if (socket) {
    try {
      await socket.logout();
    } catch {
      // Ignore errors during logout — we're cleaning up regardless
    }
    socket.end(undefined);
    socket = null;
  }

  clearAuthState();
  setState({
    status: 'logged_out',
    qrDataUrl: null,
    phone: null,
    connectedAt: null,
  });

  logger.info('Session logged out and credentials cleared');
}

// ---------------------------------------------------------------------------
// Internal connection logic
// ---------------------------------------------------------------------------

async function connect(): Promise<void> {
  const { state: authState, saveCreds } = await loadAuthState();

  socket = makeWASocket({
    auth: authState,
    printQRInTerminal: false, // We handle QR ourselves via the API
    logger: logger.child({ component: 'baileys' }) as Parameters<typeof makeWASocket>[0]['logger'],
    // Reduce noise — only store messages we explicitly care about
    getMessage: async () => undefined,
    // Prevents memory bloat by not caching messages in RAM
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    // Keep-alive ping interval (30s)
    keepAliveIntervalMs: 30_000,
    // Fix: Explicitly mask as macOS Desktop to avoid 405 error rejections
    browser: Browsers.macOS('Desktop'),
    // Workaround: Hardcode protocol version to avoid "atn" location rejection (405)
    version: [2, 3000, 1015901307],
  });

  // Persist credentials whenever they change
  socket.ev.on('creds.update', saveCreds);

  // === Connection state events ===
  socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    // New QR code available — encode as data URL
    if (qr) {
      QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', width: 400 }, (err, dataUrl) => {
        if (err) {
          logger.error({ err }, 'Failed to encode QR code');
          return;
        }
        setState({ status: 'qr_pending', qrDataUrl: dataUrl });
        logger.info('QR code ready — scan with WhatsApp to link');
      });
    }

    if (connection === 'close') {
      handleDisconnect(lastDisconnect as { error: Boom } | undefined);
    }

    if (connection === 'open') {
      handleConnected();
    }

    // Notify Laravel of status change
    WebhookService.notify('session.update', getStatus());
  });

  // === Incoming messages (Phase 2 hook — no-op for now) ===
  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe) {
          WebhookService.notify('message.inbound', {
            id: msg.key.id,
            from: jidToPhone(msg.key.remoteJid!),
            pushName: msg.pushName,
            text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '',
            timestamp: msg.messageTimestamp,
          });
          
          logger.debug(
            { id: msg.key.id, from: msg.key.remoteJid },
            'Inbound message received and webhook dispatched',
          );
        }
      }
    }
  });

  // === Message status updates (Phase 2 hook) ===
  socket.ev.on('message-receipt.update', (updates) => {
    for (const update of updates) {
      // In v7, receipt contains explicit timestamps instead of a 'type' field
      const isRead = !!update.receipt.readTimestamp;
      const rawTimestamp = update.receipt.readTimestamp || update.receipt.receiptTimestamp;
      
      // Baileys timestamps can be Long objects; convert to number
      const timestamp = typeof rawTimestamp === 'object' && rawTimestamp !== null && 'toNumber' in rawTimestamp
        ? (rawTimestamp as any).toNumber() 
        : rawTimestamp;

      WebhookService.notify('message.status.update', {
        id: update.key.id,
        phone: jidToPhone(update.key.remoteJid!),
        status: isRead ? 'read' : 'delivered',
        timestamp: timestamp,
      });
    }
    logger.debug({ count: updates.length }, 'Receipt updates received and webhooks dispatched');
  });
}

function handleConnected(): void {
  reconnectAttempts = 0;
  cancelReconnect();

  const phoneInfo = socket?.user?.id ? jidToPhone(socket.user.id) : null;

  setState({
    status: 'connected',
    qrDataUrl: null,
    phone: phoneInfo,
    connectedAt: Math.floor(Date.now() / 1000),
  });

  logger.info({ phone: state.phone }, 'WhatsApp session connected');
}

function handleDisconnect(lastDisconnect: { error: Boom } | undefined): void {
  const err = lastDisconnect?.error as Boom | undefined;
  const statusCode = err?.output?.statusCode;
  const reason = Object.entries(DisconnectReason).find(([, v]) => v === statusCode)?.[0] ?? 'Unknown';

  logger.warn(
    {
      statusCode,
      reason,
      payload: err?.output?.payload,
      data: (err as any)?.data,
    },
    'WhatsApp connection closed',
  );

  if (statusCode === DisconnectReason.loggedOut) {
    // Explicit logout or device de-linked from phone — do NOT reconnect
    logger.warn('Device was logged out — clearing credentials. Re-link required.');
    clearAuthState();
    socket = null;
    setState({
      status: 'logged_out',
      qrDataUrl: null,
      phone: null,
      connectedAt: null,
    });
    return;
  }

  // All other disconnect reasons are treated as transient — attempt reconnect
  socket = null;
  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(
      { attempts: reconnectAttempts },
      'Max reconnect attempts reached. Session suspended. Restart the bridge or call POST /session/start to retry.',
    );
    setState({ status: 'idle' });
    return;
  }

  // Exponential backoff: 3s, 6s, 12s, 24s … capped at 5 minutes
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    5 * 60 * 1000,
  );
  reconnectAttempts++;

  setState({ status: 'reconnecting' });
  logger.info({ attempt: reconnectAttempts, delayMs: delay }, 'Scheduling reconnect');

  reconnectTimer = setTimeout(async () => {
    logger.info({ attempt: reconnectAttempts }, 'Attempting reconnect');
    try {
      await connect();
    } catch (err) {
      logger.error({ err }, 'Reconnect attempt failed');
      scheduleReconnect();
    }
  }, delay);
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Phase 2 stubs — event hooks already wired; just need implementations
// ---------------------------------------------------------------------------
// These functions will POST events to the Laravel webhook URL when
// LARAVEL_WEBHOOK_URL is configured. For now they are no-ops.

export {}; // keep module scope clean
