/** Crypto checkout is available to all signed-in accounts. */
export const CRYPTO_ALLOWED_EMAILS: string[] = [];

export function canUseCrypto(_email?: string | null): boolean {
  return true;
}
