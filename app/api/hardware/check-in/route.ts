import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { DeviceStatus, RegistrationStatus } from "@/lib/generated/prisma/enums";

const checkInSchema = z.object({
  deviceIdentifier: z.string().min(1),
  // A badge scan carries the token; the kiosk's manual fallback sends the
  // registration id instead, so the search endpoint never has to hand out
  // credentials.
  credentialToken: z.string().min(1).optional(),
  registrationId: z.string().min(1).optional(),
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

  const { deviceIdentifier, credentialToken, registrationId } = parsed.data;

  const target =
    credentialToken !== undefined
      ? { credentialToken }
      : registrationId !== undefined
        ? { id: registrationId }
        : null;

  if (!target) {
    return apiError("Provide a credentialToken or a registrationId", 400);
  }

  // Record that the kiosk is alive, whether or not the scan succeeds.
  await db.device.updateMany({
    where: { deviceIdentifier },
    data: { lastHeartbeatAt: new Date(), status: DeviceStatus.ACTIVE },
  });

  // Conditional update so two kiosks scanning the same badge at once cannot
  // both observe REGISTERED and both report a successful check-in.
  const claimed = await db.registration.updateMany({
    where: { ...target, status: RegistrationStatus.REGISTERED },
    data: { status: RegistrationStatus.CHECKED_IN, checkedInAt: new Date() },
  });

  if (claimed.count === 1) {
    const registration = await db.registration.findUnique({
      where: target,
      include: { attendee: true },
    });

    return NextResponse.json({
      success: true,
      // `name` is optional, so fall back to the email as the kiosk label.
      attendeeName:
        registration?.attendee.name || registration?.attendee.email || "",
      checkedInAt: registration?.checkedInAt ?? null,
    });
  }

  const existing = await db.registration.findUnique({
    where: target,
    select: {
      status: true,
      checkedInAt: true,
      attendee: { select: { name: true, email: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ success: false, message: "Invalid credential" });
  }

  if (existing.status === RegistrationStatus.CHECKED_IN) {
    return NextResponse.json({
      success: false,
      message: "Already checked in",
      // Lets the kiosk show *when*, rather than just that it happened.
      checkedInAt: existing.checkedInAt,
      attendeeName: existing.attendee.name || existing.attendee.email || "",
    });
  }

  return NextResponse.json({
    success: false,
    message: "Registration cancelled",
    attendeeName: existing.attendee.name || existing.attendee.email || "",
  });
}
