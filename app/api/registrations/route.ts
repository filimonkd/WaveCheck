import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, isUniqueViolation, readJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { EventStatus, Role, RegistrationStatus } from "@/lib/generated/prisma/enums";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Sign-up details for the public registration page, which registers someone
 * who has no account yet. An existing email must prove ownership with the
 * matching password, so this cannot be used to register on someone's behalf.
 */
const attendeeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const createRegistrationSchema = z.object({
  eventId: z.string().min(1),
  // The only way to say who is registering. There used to be a bare
  // `attendeeId` here, which let any caller register any user by id; naming
  // an account now means proving you hold its password.
  attendee: attendeeSchema,
  customFieldResponses: z.record(z.string(), z.json()).default({}),
});

type AttendeeInput = z.infer<typeof attendeeSchema>;

type AttendeeResolution =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Find the account for these credentials, creating it the first time. */
async function findOrCreateAttendee(
  input: AttendeeInput,
): Promise<AttendeeResolution> {
  const existing = await db.user.findUnique({ where: { email: input.email } });

  if (!existing) {
    const created = await db.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: Role.ATTENDEE,
      },
    });

    return { ok: true, id: created.id };
  }

  if (!(await verifyPassword(input.password, existing.passwordHash))) {
    return {
      ok: false,
      error: "That email already has an account; the password did not match",
    };
  }

  return { ok: true, id: existing.id };
}

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

  // The route is public, so identity has to be proved on the request itself:
  // either the email is new, or its password matches.
  const resolved = await findOrCreateAttendee(parsed.data.attendee);

  if (!resolved.ok) {
    return apiError(resolved.error, 401);
  }

  const resolvedAttendeeId = resolved.id;

  // No separate attendee lookup: findOrCreateAttendee already returned a real
  // user, either freshly created or password-verified.
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: { customFields: true },
  });

  if (!event) {
    return apiError("Event not found", 404);
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
          attendeeId: resolvedAttendeeId,
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
