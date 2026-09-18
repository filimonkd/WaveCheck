/**
 * Headers a kiosk authenticates with.
 *
 * Kept free of server imports so the kiosk client bundle can use these names
 * without pulling in Prisma or node:crypto.
 */
export const DEVICE_IDENTIFIER_HEADER = "x-device-identifier";
export const DEVICE_API_KEY_HEADER = "x-device-api-key";
