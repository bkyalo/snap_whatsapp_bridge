import { useMultiFileAuthState, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import { config } from '../config';

/**
 * Production auth state using Baileys' useMultiFileAuthState.
 *
 * This is NOT the demo useSingleFileAuthState. Multi-file stores each
 * credential key in a separate JSON file in the auth_state directory,
 * making it robust to partial saves and process crashes.
 *
 * Security note: credentials are stored in plaintext JSON on disk.
 * For high-security environments, consider encrypting the auth_state
 * directory at rest (e.g., via LUKS on Linux or a secrets manager).
 * The directory should be chmod 700 and owned by the node process user.
 *
 * @returns Baileys-compatible { state, saveCreds } pair
 */
export async function loadAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const authDir = path.resolve(config.session.authStateDir);

  // Ensure the directory exists with restricted permissions
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
    logger.info({ authDir }, 'Created auth state directory');
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  logger.info({ authDir }, 'Auth state loaded');

  return { state, saveCreds };
}

/**
 * Clears all stored credentials from the auth_state directory.
 * Called on explicit logout or after a logged-out disconnect reason.
 */
export function clearAuthState(): void {
  const authDir = path.resolve(config.session.authStateDir);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
    logger.info({ authDir }, 'Auth state cleared');
  }
}

// TypeScript helper — re-export the SignalDataTypeMap so consumers
// don't need to import from baileys directly if iterating keys.
export type { SignalDataTypeMap };
