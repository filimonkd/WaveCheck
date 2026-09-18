import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { DeviceStatus, RegistrationStatus } from "@/lib/generated/prisma/enums";

const checkInSchema = z.object({
  deviceIdentifier: z.string().min(1),
  credentialToken: z.string().min(1),
});

/**
 * Check-in endpoint for the Phase 2 RFID / QR kiosks.
 *
 * Every business outcome returns HTTP 200 with a `success` flag: kiosk
 * firmware routinely collapses non-2xx responses into a generic "network
 * error" and would swallow the message we want shown on the screen. Only a
 * malformed request is a non-2xx.
 *
 * NOTE: this endpoint is unauthenticated — `deviceIdentifier` is an
 * identifier, not a secret. See README before Phase 2 hardware ships.
 */
export async function POST(request: Request) {
  const parsed = checkInSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { deviceIdentifier, credentialToken } = parsed.data;

  // Record that the kiosk is alive, whether or not the scan succeeds.
  await db.device.updateMany({
    where: { deviceIdentifier },
    data: { lastHeartbeatAt: new Date(), status: DeviceStatus.ACTIVE },
  });

  // Conditional update so two kiosks scanning the same badge at once cannot
  // both observe REGISTERED and both report a successful check-in.
  const claimed = await db.registration.updateMany({
    where: { credentialToken, status: RegistrationStatus.REGISTERED },
    data: { status: RegistrationStatus.CHECKED_IN, checkedInAt: new Date() },
  });

  if (claimed.count === 1) {
    const registration = await db.registration.findUnique({
      where: { credentialToken },
      include: { attendee: true },
    });

    return NextResponse.json({
      success: true,
      // The User model has no display name yet, so the email identifies the
      // attendee on the kiosk screen.
      attendeeName: registration?.attendee.email ?? "",
    });
  }

  const existing = await db.registration.findUnique({
    where: { credentialToken },
    select: { status: true },
  });

  if (!existing) {
    return NextResponse.json({ success: false, message: "Invalid credential" });
  }

  if (existing.status === RegistrationStatus.CHECKED_IN) {
    return NextResponse.json({ success: false, message: "Already checked in" });
  }

  return NextResponse.json({
    success: false,
    message: "Registration cancelled",
  });
}
