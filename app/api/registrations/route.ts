import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, isUniqueViolation, readJson, validationError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EventStatus, RegistrationStatus } from "@/lib/generated/prisma/enums";

const createRegistrationSchema = z.object({
  eventId: z.string().min(1),
  // Only consulted when the request has no session. See the note below.
  attendeeId: z.string().min(1).optional(),
  customFieldResponses: z.record(z.string(), z.json()).default({}),
});

/** Registrations that hold a seat. Cancelled ones free their seat up again. */
const SEAT_HOLDING = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.CHECKED_IN,
];

export async function POST(request: Request) {
  const parsed = createRegistrationSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { eventId, customFieldResponses } = parsed.data;
  const session = await auth();

  // This route is currently public, so an unauthenticated caller has to name
  // the attendee. That means anyone can register anyone; see README before
  // exposing this beyond the MVP.
  const attendeeId = session?.user?.id ?? parsed.data.attendeeId;

  if (!attendeeId) {
    return apiError("attendeeId is required when not signed in", 400);
  }

  const [event, attendee] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      include: { customFields: true },
    }),
    db.user.findUnique({ where: { id: attendeeId } }),
  ]);

  if (!event) {
    return apiError("Event not found", 404);
  }

  if (!attendee) {
    return apiError("Attendee not found", 404);
  }

  if (event.status !== EventStatus.PUBLISHED) {
    return apiError("Event is not open for registration", 409);
  }

  const missing = event.customFields
    .filter((field) => field.isRequired)
    .filter((field) => {
      const answer = customFieldResponses[field.id];
      return answer === undefined || answer === null || answer === "";
    })
    .map((field) => field.label);

  if (missing.length > 0) {
    return apiError(`Missing required field(s): ${missing.join(", ")}`, 400);
  }

  try {
    const registration = await db.$transaction(async (tx) => {
      const taken = await tx.registration.count({
        where: { eventId, status: { in: SEAT_HOLDING } },
      });

      if (taken >= event.maxCapacity) {
        return null;
      }

      return tx.registration.create({
        data: {
          eventId,
          attendeeId,
          // Opaque credential the Phase 2 kiosks scan.
          credentialToken: randomUUID(),
          status: RegistrationStatus.REGISTERED,
          customFieldResponses,
        },
      });
    });

    if (!registration) {
      return apiError("Event is at capacity", 409);
    }

    return NextResponse.json({ registration }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("Already registered for this event", 409);
    }

    throw error;
  }
}
