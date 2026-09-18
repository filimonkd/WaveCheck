import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { DeviceStatus } from "@/lib/generated/prisma/enums";

const heartbeatSchema = z.object({
  deviceIdentifier: z.string().min(1).max(200),
  // `Device.locationName` is required and has no default, so a kiosk checking
  // in for the very first time needs something to record.
  locationName: z.string().min(1).max(200).optional(),
});

const UNASSIGNED_LOCATION = "Unassigned";

/**
 * Registers a kiosk and marks it alive.
 *
 * NOTE: unauthenticated, like the rest of `/api/hardware`. `deviceIdentifier`
 * is an identifier, not a secret, so anyone who can reach this can create
 * Device rows. See README before Phase 2 hardware ships.
 */
export async function POST(request: Request) {
  const parsed = heartbeatSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { deviceIdentifier, locationName } = parsed.data;

  const device = await db.device.upsert({
    where: { deviceIdentifier },
    update: {
      lastHeartbeatAt: new Date(),
      status: DeviceStatus.ACTIVE,
      // Only overwrite the recorded location when one was supplied.
      ...(locationName ? { locationName } : {}),
    },
    create: {
      deviceIdentifier,
      locationName: locationName ?? UNASSIGNED_LOCATION,
      status: DeviceStatus.ACTIVE,
      lastHeartbeatAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    device: {
      deviceIdentifier: device.deviceIdentifier,
      locationName: device.locationName,
      status: device.status,
      lastHeartbeatAt: device.lastHeartbeatAt,
    },
  });
}
