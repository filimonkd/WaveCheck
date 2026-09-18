import { randomBytes } from "node:crypto";

import type { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import type { DeviceModel } from "@/lib/generated/prisma/models";
import {
  DEVICE_API_KEY_HEADER,
  DEVICE_IDENTIFIER_HEADER,
} from "@/lib/hardware-headers";
import { hashPassword, verifyPassword } from "@/lib/password";

export { DEVICE_API_KEY_HEADER, DEVICE_IDENTIFIER_HEADER };

export type DeviceAuthResult =
  | { ok: true; device: DeviceModel }
  | { ok: false; response: NextResponse };

/**
 * A throwaway hash to verify against when no device matched.
 *
 * Without it an unknown identifier would return in microseconds while a known
 * one would pay for a scrypt comparison, and that timing difference is enough
 * to enumerate which kiosks exist. Computed once, lazily.
 */
let dummyHash: Promise<string> | undefined;

function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHash;
}

/**
 * Authenticates a kiosk from its request headers.
 *
 * Returns a result rather than throwing: an uncaught throw inside a route
 * handler surfaces as a 500, and a failed credential check should be a 401.
 * Callers do `if (!auth.ok) return auth.response;`.
 */
export async function validateDeviceAuth(
  request: Request,
): Promise<DeviceAuthResult> {
  const deviceIdentifier = request.headers.get(DEVICE_IDENTIFIER_HEADER);
  const apiKey = request.headers.get(DEVICE_API_KEY_HEADER);

  if (!deviceIdentifier || !apiKey) {
    return {
      ok: false,
      response: apiError(
        `Device credentials required in ${DEVICE_IDENTIFIER_HEADER} and ${DEVICE_API_KEY_HEADER}`,
        401,
      ),
    };
  }

  const device = await db.device.findUnique({ where: { deviceIdentifier } });

  // Always run a comparison, even for an unknown device, so the response time
  // is the same either way.
  const matches = await verifyPassword(
    apiKey,
    device?.apiKeyHash ?? (await getDummyHash()),
  );

  // One message for every failure: an unknown device, one provisioned before
  // key auth existed, and a wrong key are indistinguishable to the caller.
  if (!device?.apiKeyHash || !matches) {
    return { ok: false, response: apiError("Invalid device credentials", 401) };
  }

  return { ok: true, device };
}
