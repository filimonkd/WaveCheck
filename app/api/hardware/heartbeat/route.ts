import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { DeviceStatus } from "@/lib/generated/prisma/enums";
import { validateDeviceAuth } from "@/lib/hardware-auth";

const heartbeatSchema = z.object({
  // The device is identified by its headers; this only lets a kiosk correct
  // the location it is recorded at.
  locationName: z.string().min(1).max(200).optional(),
});

/**
 * Marks an authenticated kiosk alive.
 *
 * This no longer creates devices. A kiosk must already hold credentials
 * issued from the organizer dashboard, so there is no unauthenticated path
 * that can write a Device row.
 */
export async function POST(request: Request) {
  const auth = await validateDeviceAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const parsed = heartbeatSchema.safeParse((await readJson(request)) ?? {});

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { locationName } = parsed.data;

  const device = await db.device.update({
    where: { id: auth.device.id },
    data: {
      lastHeartbeatAt: new Date(),
      status: DeviceStatus.ACTIVE,
      ...(locationName ? { locationName } : {}),
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
