import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, validationError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CustomFieldType, EventStatus, Role } from "@/lib/generated/prisma/enums";

const ORGANIZER_ROLES: Role[] = [Role.ORGANIZER, Role.ADMIN];

const customFieldSchema = z
  .object({
    label: z.string().min(1).max(200),
    type: z.enum(CustomFieldType),
    isRequired: z.boolean().default(false),
    options: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (field) => field.type !== CustomFieldType.DROPDOWN || field.options.length > 0,
    { message: "DROPDOWN fields need at least one option", path: ["options"] },
  );

const createEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    maxCapacity: z.number().int().positive(),
    // ARCHIVED is deliberately not creatable.
    status: z.enum([EventStatus.DRAFT, EventStatus.PUBLISHED]).optional(),
    customFields: z.array(customFieldSchema).optional(),
  })
  .refine((event) => event.endTime > event.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });

/** Public: list published events, soonest first. */
export async function GET() {
  const events = await db.event.findMany({
    where: { status: EventStatus.PUBLISHED },
    orderBy: { startTime: "asc" },
    include: { customFields: true },
  });

  return NextResponse.json({ events });
}

/** Organizers and admins create events. */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return apiError("Authentication required", 401);
  }

  if (!ORGANIZER_ROLES.includes(session.user.role)) {
    return apiError("Only organizers and admins can create events", 403);
  }

  const parsed = createEventSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { customFields, ...event } = parsed.data;

  const created = await db.event.create({
    data: {
      ...event,
      organizerId: session.user.id,
      customFields: customFields?.length
        ? { create: customFields }
        : undefined,
    },
    include: { customFields: true },
  });

  return NextResponse.json({ event: created }, { status: 201 });
}
