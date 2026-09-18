import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { EventStatus, RegistrationStatus } from "@/lib/generated/prisma/enums";

/**
 * Published events with their live check-in tallies, for the kiosk's event
 * selector and stats line.
 *
 * Separate from the public `GET /api/events` on purpose: attendance numbers
 * are operational data and do not belong on the endpoint the marketing pages
 * would use.
 */
export async function GET() {
  const events = await db.event.findMany({
    where: { status: EventStatus.PUBLISHED },
    orderBy: { startTime: "asc" },
    select: { id: true, title: true, startTime: true, maxCapacity: true },
  });

  const tallies = await db.registration.groupBy({
    by: ["eventId", "status"],
    _count: { _all: true },
    where: { eventId: { in: events.map((event) => event.id) } },
  });

  const countsByEvent = new Map<string, { registered: number; checkedIn: number }>();

  for (const tally of tallies) {
    const counts = countsByEvent.get(tally.eventId) ?? {
      registered: 0,
      checkedIn: 0,
    };

    // A cancelled registration is not someone we expect through the door.
    if (tally.status === RegistrationStatus.CHECKED_IN) {
      counts.checkedIn += tally._count._all;
      counts.registered += tally._count._all;
    } else if (tally.status === RegistrationStatus.REGISTERED) {
      counts.registered += tally._count._all;
    }

    countsByEvent.set(tally.eventId, counts);
  }

  return NextResponse.json({
    events: events.map((event) => ({
      ...event,
      totalRegistrations: countsByEvent.get(event.id)?.registered ?? 0,
      checkedIn: countsByEvent.get(event.id)?.checkedIn ?? 0,
    })),
  });
}
