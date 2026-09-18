import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EventStatus, Role } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { CreateEventForm } from "./create-event-form";

export const metadata = { title: "Dashboard · WaveCheck" };

const ORGANIZER_ROLES: Role[] = [Role.ORGANIZER, Role.ADMIN];

/** Rendered on the server, so format in UTC rather than the server's zone. */
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const STATUS_STYLES: Record<EventStatus, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  PUBLISHED: "bg-primary text-primary-foreground",
  ARCHIVED: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

export default async function DashboardPage() {
  const session = await auth();

  // `proxy.ts` only checks that a session cookie exists. This is the real
  // check: it reads the verified session and the role on it.
  if (!session?.user) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  if (!ORGANIZER_ROLES.includes(session.user.role)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Not available</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            <p>
              You are signed in as {session.user.email} ({session.user.role}).
              The dashboard is for organizers and admins.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Admins oversee everything; an organizer sees only the events they own.
  const events = await db.event.findMany({
    where:
      session.user.role === Role.ADMIN
        ? undefined
        : { organizerId: session.user.id },
    orderBy: { startTime: "asc" },
  });

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 sm:p-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {session.user.email} ({session.user.role})
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Create Event</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateEventForm />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Events ({events.length})
        </h2>

        {events.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-sm">
              No events yet. Create one above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card key={event.id} className="flex flex-col">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg">{event.title}</CardTitle>
                    <StatusBadge status={event.status} />
                  </div>
                </CardHeader>
                <CardContent className="text-muted-foreground space-y-2 text-sm">
                  <p>
                    <span className="text-foreground font-medium">Starts</span>{" "}
                    {dateFormat.format(event.startTime)} UTC
                  </p>
                  <p>
                    <span className="text-foreground font-medium">Ends</span>{" "}
                    {dateFormat.format(event.endTime)} UTC
                  </p>
                  <p>Capacity {event.maxCapacity}</p>
                  {event.status === EventStatus.PUBLISHED ? (
                    <p className="pt-1">
                      <a
                        href={`/register/${event.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Registration page →
                      </a>
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
