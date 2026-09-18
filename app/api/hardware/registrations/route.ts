import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validationError } from "@/lib/api";
import { db } from "@/lib/db";

const searchSchema = z.object({
  eventId: z.string().min(1),
  // A minimum length keeps this from being a "list every attendee" endpoint.
  q: z.string().trim().min(3, "Enter at least 3 characters").max(200),
});

const MAX_RESULTS = 10;

/**
 * Name/email lookup for the kiosk's manual fallback, when a badge will not
 * scan.
 *
 * Deliberately never returns `credentialToken`: that token IS the credential,
 * and this endpoint is unauthenticated. Manual check-in therefore posts the
 * registration id instead. Results are capped and require a 3-character query,
 * but this still exposes attendee names and emails to anyone who can reach it
 * — see README; it needs device authentication before Phase 2.
 */
export async function GET(request: NextRequest) {
  const parsed = searchSchema.safeParse({
    eventId: request.nextUrl.searchParams.get("eventId"),
    q: request.nextUrl.searchParams.get("q"),
  });

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { eventId, q } = parsed.data;

  const registrations = await db.registration.findMany({
    where: {
      eventId,
      attendee: {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
    },
    take: MAX_RESULTS,
    orderBy: { attendee: { email: "asc" } },
    select: {
      id: true,
      status: true,
      checkedInAt: true,
      attendee: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    registrations: registrations.map((registration) => ({
      id: registration.id,
      status: registration.status,
      checkedInAt: registration.checkedInAt,
      name: registration.attendee.name,
      email: registration.attendee.email,
    })),
  });
}
