import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { EventStatus } from "@/lib/generated/prisma/enums";

import { RegistrationForm, type RegistrationField } from "./registration-form";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function RegisterPage({
  params,
}: PageProps<"/register/[eventId]">) {
  const { eventId } = await params;

  const event = await db.event.findUnique({
    where: { id: eventId },
    // Ordered so the form renders the same way on every request.
    include: { customFields: { orderBy: { label: "asc" } } },
  });

  // Draft and archived events must not be registrable, and revealing that
  // they exist would leak an organizer's unpublished plans.
  if (!event || event.status !== EventStatus.PUBLISHED) {
    notFound();
  }

  // `options` is Json, so narrow it here rather than shipping an unknown
  // shape to the client.
  const fields: RegistrationField[] = event.customFields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    isRequired: field.isRequired,
    options: Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === "string")
      : [],
  }));

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
          <RegistrationForm eventId={event.id} fields={fields} />
        </CardContent>
      </Card>
    </main>
  );
}
