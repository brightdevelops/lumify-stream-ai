/** Accounts allowed to use crypto checkout (lowercase emails). */
export const CRYPTO_ALLOWED_EMAILS = ["brightsolutionslab@gmail.com"];

export function canUseCrypto(email?: string | null): boolean {
  return !!email && CRYPTO_ALLOWED_EMAILS.includes(email.toLowerCase());
}
