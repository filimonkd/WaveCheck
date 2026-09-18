import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { EventStatus } from "@/lib/generated/prisma/enums";

import { RegistrationForm } from "./registration-form";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function RegisterPage({
  params,
}: PageProps<"/register/[eventId]">) {
  const { eventId } = await params;

  const event = await db.event.findUnique({ where: { id: eventId } });

  // Draft and archived events must not be registrable, and revealing that
  // they exist would leak an organizer's unpublished plans.
  if (!event || event.status !== EventStatus.PUBLISHED) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 sm:p-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
        <p className="text-muted-foreground text-sm">
          {dateFormat.format(event.startTime)} UTC
        </p>
        {event.description ? (
          <p className="text-muted-foreground">{event.description}</p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent>
          <RegistrationForm eventId={event.id} />
        </CardContent>
      </Card>
    </main>
  );
}
