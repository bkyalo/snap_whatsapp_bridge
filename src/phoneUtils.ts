/**
 * Phone number normalization utilities.
 *
 * Converts raw phone strings (as submitted by Laravel or admins) into the
 * E.164-style digits that WhatsApp uses in JID format: `{digits}@s.whatsapp.net`
 *
 * Supported input formats:
 *   - Kenyan local:  0712345678  →  254712345678
 *   - Kenyan intl:   +254712345678 or 254712345678  →  254712345678
 *   - Other intl:    +1234567890 or 1234567890 (with country code)
 *
 * Does NOT attempt to add a country code if the number is ambiguous.
 * The caller must supply a valid full international number or a recognized Kenyan format.
 */

export class PhoneNormalizationError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}

/**
 * Strips non-digit characters and applies Kenyan number normalization.
 * Returns the numeric string (no + prefix, no @domain).
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new PhoneNormalizationError('Phone number must be a non-empty string', String(raw));
  }

  // Strip whitespace, dashes, parentheses, dots
  let digits = raw.replace(/[\s\-().+]/g, '');

  // Must be all digits at this point
  if (!/^\d+$/.test(digits)) {
    throw new PhoneNormalizationError(
      `Phone number contains invalid characters after normalization: "${digits}"`,
      raw,
    );
  }

  // --- Kenyan number normalization ---
  // 07xxxxxxxx or 01xxxxxxxx → 2547xxxxxxxx / 2541xxxxxxxx
  if (/^0[17]\d{8}$/.test(digits)) {
    digits = '254' + digits.slice(1);
  }

  // 7xxxxxxxx or 1xxxxxxxx (9 digits, Kenyan without leading 0) → 254...
  if (/^[17]\d{8}$/.test(digits)) {
    digits = '254' + digits;
  }

  // Sanity check: minimum 7 digits (local), maximum 15 (E.164 max)
  if (digits.length < 7 || digits.length > 15) {
    throw new PhoneNormalizationError(
      `Normalized phone number has unexpected length (${digits.length}): "${digits}"`,
      raw,
    );
  }

  return digits;
}

/**
 * Normalizes a phone number and returns the WhatsApp JID.
 * Example: "0712345678" → "254712345678@s.whatsapp.net"
 */
export function toWhatsAppJid(raw: string): string {
  const digits = normalizePhone(raw);
  return `${digits}@s.whatsapp.net`;
}

/**
 * Extracts the numeric portion from a JID, for display/logging.
 * Example: "254712345678@s.whatsapp.net" → "254712345678"
 */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}
