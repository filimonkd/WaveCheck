/**
 * Auth.js session cookie names, in their plain and secure-prefixed forms.
 *
 * Kept free of any Prisma or Auth.js import: `proxy.ts` runs on every matched
 * request, so it must not drag the database client into that path.
 */
export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;
