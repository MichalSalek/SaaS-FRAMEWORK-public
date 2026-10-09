import { randomBytes } from 'crypto';

/**
 * Generate cryptographically secure pairing token
 *
 * @returns {string} Base64url encoded token (128-bit entropy, ~22 chars)
 *
 * Security:
 * - CSPRNG (crypto.randomBytes)
 * - 128-bit entropy (16 bytes)
 * - URL-safe encoding (base64url, no padding)
 * - Single-use enforcement in database
 */
export const generatePairingToken = (): string => {
  const buffer = randomBytes(16); // 128-bit entropy
  return buffer.toString('base64url'); // URL-safe, no padding
};

/**
 * Generate token expiry timestamp
 *
 * @param {number} ttlMinutes - Time to live in minutes (default: 15)
 * @returns {Date} Expiry timestamp
 */
export const generateTokenExpiry = ({
  ttlMinutes = 15,
}: { ttlMinutes?: number } = {}): Date => {
  return new Date(Date.now() + ttlMinutes * 60 * 1000);
};
